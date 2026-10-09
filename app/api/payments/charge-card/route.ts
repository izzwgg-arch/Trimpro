import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { recordAuditLog, auditContextFromRequest } from '@/lib/audit/log'
import { chargeSavedCard, cardknoxConfigured } from '@/lib/services/cardknox-gateway'
import { applyInvoicePayment } from '@/lib/payments/apply-payment'
import { afterInvoicePayment } from '@/lib/payments/after-invoice-payment'
import { createOverpaymentCredit } from '@/lib/payments/customer-credit'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import { sendPaymentReceiptForPayment } from '@/lib/payments/receipts'

export const runtime = 'nodejs'

function r2(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}

/**
 * Staff-initiated credit-card charge of a SAVED card across one or more invoices.
 * The card is charged ONCE at Cardknox; invoice balances are only updated after
 * the processor confirms success (xResult=A). Idempotent via idempotencyKey so a
 * double-submit never double-charges.
 */
export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.manage')
  if (permError) return permError
  const user = getAuthUser(request)

  try {
    if (!cardknoxConfigured()) {
      return NextResponse.json({ error: 'Card processing is not configured.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const clientId = String(body?.clientId || '').trim()
    const cardOnFileId = String(body?.cardOnFileId || '').trim()
    const memo = body?.memo ? String(body.memo).trim() : null
    const rawAllocations = Array.isArray(body?.allocations) ? body.allocations : []
    const allocations = rawAllocations
      .map((a: any) => ({ invoiceId: String(a?.invoiceId || '').trim(), amount: r2(a?.amount) }))
      .filter((a: { invoiceId: string; amount: number }) => a.invoiceId && a.amount > 0)

    if (!clientId) return NextResponse.json({ error: 'Customer is required' }, { status: 400 })
    if (!cardOnFileId) return NextResponse.json({ error: 'A saved card is required' }, { status: 400 })
    if (allocations.length === 0) return NextResponse.json({ error: 'Select at least one invoice to apply the payment to.' }, { status: 400 })

    const card = await prisma.cardOnFile.findFirst({
      where: { id: cardOnFileId, tenantId: user.tenantId, clientId, status: 'ACTIVE' },
      select: { id: true, token: true },
    })
    if (!card) return NextResponse.json({ error: 'Saved card not found for this customer' }, { status: 404 })

    // Validate every target invoice belongs to this customer and isn't closed,
    // and never over-apply beyond an invoice's balance.
    const invoiceIds = allocations.map((a: { invoiceId: string }) => a.invoiceId)
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, tenantId: user.tenantId, clientId },
      select: { id: true, invoiceNumber: true, balance: true, status: true },
    })
    const byId = new Map(invoices.map((i) => [i.id, i]))
    for (const a of allocations) {
      const inv = byId.get(a.invoiceId)
      if (!inv) return NextResponse.json({ error: 'An invoice was not found for this customer.' }, { status: 404 })
      if (['CANCELLED', 'REFUNDED'].includes(String(inv.status))) {
        return NextResponse.json({ error: `Invoice ${inv.invoiceNumber} cannot accept a payment.` }, { status: 400 })
      }
      if (a.amount > r2(inv.balance) + 0.005) {
        return NextResponse.json({ error: `Amount for ${inv.invoiceNumber} exceeds its balance.` }, { status: 400 })
      }
    }

    const total = r2(allocations.reduce((s: number, a: { amount: number }) => s + a.amount, 0))
    if (!(total > 0)) return NextResponse.json({ error: 'Total must be greater than zero.' }, { status: 400 })

    // Idempotency: one charge per key. Reserve the key BEFORE charging so a retry
    // cannot double-charge; return the stored result if already completed.
    const idemKey =
      String(body?.idempotencyKey || '').trim() ||
      `cardcharge:${crypto.createHash('sha256').update(`${cardOnFileId}|${total}|${invoiceIds.slice().sort().join(',')}`).digest('hex')}`
    const scope = 'staff-card-charge'

    const existing = await prisma.idempotencyKey.findFirst({ where: { key: idemKey, scope }, select: { response: true } })
    if (existing) {
      const resp = (existing.response || {}) as any
      if (resp?.refNum || resp?.status === 'completed') {
        return NextResponse.json({ ok: true, idempotent: true, refNum: resp.refNum || null, paymentIds: resp.paymentIds || [] })
      }
      return NextResponse.json({ error: 'A charge for this request is already in progress.' }, { status: 409 })
    }
    try {
      await prisma.idempotencyKey.create({
        data: {
          tenantId: user.tenantId,
          key: idemKey,
          scope,
          response: { status: 'pending' },
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
        },
      })
    } catch {
      return NextResponse.json({ error: 'A charge for this request is already in progress.' }, { status: 409 })
    }

    // Charge the card ONCE for the full total.
    const client = await prisma.client.findFirst({ where: { id: clientId }, select: { name: true, email: true } })
    let refNum: string | null = null
    try {
      const result = await chargeSavedCard({
        token: card.token,
        amount: total,
        invoiceNumber: invoices.map((i) => i.invoiceNumber).join(', ').slice(0, 100),
        description: memo || 'Card payment',
        name: client?.name || undefined,
        email: client?.email || undefined,
      })
      refNum = result.refNum
    } catch (err: any) {
      // Charge failed — release the idempotency reservation so a corrected retry can proceed.
      await prisma.idempotencyKey.deleteMany({ where: { key: idemKey, scope } }).catch(() => null)
      return NextResponse.json({ error: `Card declined: ${String(err?.message || 'charge failed')}` }, { status: 402 })
    }

    // Charge succeeded — now (and only now) apply to invoices.
    const providerPaymentId = refNum || `ck_${crypto.randomBytes(8).toString('hex')}`
    const groupId = `pg_card_${providerPaymentId}`
    const paymentIds: string[] = []
    let applied = 0
    for (const a of allocations) {
      const inv = byId.get(a.invoiceId)!
      const res = await applyInvoicePayment({
        invoiceId: a.invoiceId,
        amount: a.amount,
        method: 'CARD' as any,
        provider: 'cardknox',
        providerPaymentId: `${providerPaymentId}:${a.invoiceId}`,
        reference: refNum ? `Card ${refNum} — ${inv.invoiceNumber}` : `Card — ${inv.invoiceNumber}`,
        processedAt: new Date(),
        notes: memo || 'Card payment',
        paymentGroupId: groupId,
        dedupeWhere: { provider: 'cardknox', providerPaymentId: `${providerPaymentId}:${a.invoiceId}` },
      })
      if (res.created && res.paymentId) {
        paymentIds.push(res.paymentId)
        const row = await prisma.payment.findUnique({ where: { id: res.paymentId }, select: { amount: true } })
        applied = r2(applied + r2(row?.amount || 0))
        await afterInvoicePayment(a.invoiceId).catch(() => null)
        await sendPaymentReceiptForPayment(res.paymentId, user.tenantId).catch(() => null)
      }
    }
    if (paymentIds.length > 0) {
      await enqueueQboSync(user.tenantId, 'payment', paymentIds[0], { processImmediately: true }).catch(() => null)
    }

    // Any charged amount we couldn't apply (shouldn't happen given validation) -> credit.
    const leftover = r2(total - applied)
    if (leftover > 0.005) {
      await prisma.$transaction(async (tx) => {
        await createOverpaymentCredit(tx, {
          tenantId: user.tenantId,
          clientId,
          amount: leftover,
          sourcePaymentId: paymentIds[0] || null,
          sourcePaymentGroupId: groupId,
          reason: 'Card payment (credit on account)',
        })
      })
    }

    await prisma.idempotencyKey.updateMany({
      where: { key: idemKey, scope },
      data: { response: { status: 'completed', refNum, paymentIds } },
    }).catch(() => null)

    void recordAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'CREATE',
      entityType: 'Payment',
      entityId: paymentIds[0] || providerPaymentId,
      changes: { kind: 'card_charge', clientId, total, refNum, invoiceIds },
      ...auditContextFromRequest(request),
    })

    return NextResponse.json({ ok: true, refNum, paymentIds, applied, leftover })
  } catch (error) {
    console.error('Charge card error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
