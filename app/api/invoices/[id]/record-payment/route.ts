import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { notifyInvoicePaid } from '@/lib/notifications'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import { afterInvoicePayment } from '@/lib/payments/after-invoice-payment'
import { applyInvoicePayment } from '@/lib/payments/apply-payment'
import { createOverpaymentCredit } from '@/lib/payments/customer-credit'
import crypto from 'crypto'

const ALLOWED_METHODS = new Set(['CHECK', 'QUICK_PAY', 'OTHER'])

function round2(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}

/**
 * Record a payment of a given total and AUTO-APPLY it across the customer's open
 * invoices (the invoice it was started from first, then oldest-first). Any
 * remainder is held as customer credit. Returns the created payment so the UI
 * can open the payment editor to fine-tune the distribution.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.manage')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const body = await request.json().catch(() => ({}))
    const method = String(body?.method || '').trim().toUpperCase()
    const methodLabel = String(body?.methodLabel || '').trim()
    const amount = round2(body?.amount)
    const reference = String(body?.reference || '').trim() || null
    const paidAtRaw = body?.paidAt ? new Date(String(body.paidAt)) : null
    const processedAt = paidAtRaw && !Number.isNaN(paidAtRaw.getTime()) ? paidAtRaw : new Date()

    if (!ALLOWED_METHODS.has(method)) {
      return NextResponse.json({ error: 'Payment method must be CHECK, QUICK_PAY, or OTHER' }, { status: 400 })
    }
    if (method === 'OTHER' && !methodLabel) {
      return NextResponse.json({ error: 'Please enter a payment type name.' }, { status: 400 })
    }
    if (amount <= 0) {
      return NextResponse.json({ error: 'Enter a payment amount greater than zero.' }, { status: 400 })
    }

    const current = await prisma.invoice.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true, clientId: true, status: true, client: { select: { name: true } } },
    })
    if (!current) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (current.status === 'CANCELLED' || current.status === 'REFUNDED') {
      return NextResponse.json({ error: 'This invoice cannot accept payments.' }, { status: 400 })
    }

    // Explicit split (from the new-payment editor) or auto oldest-first.
    const rawAllocations = Array.isArray(body?.allocations) ? body.allocations : null
    let explicitPlan: Array<{ invoiceId: string; amount: number }> | null = null
    if (rawAllocations) {
      const allocs: Array<{ invoiceId: string; amount: number }> = (rawAllocations as any[])
        .map((a: any) => ({ invoiceId: String(a?.invoiceId || ''), amount: round2(a?.amount) }))
        .filter((a: { invoiceId: string; amount: number }) => a.invoiceId && a.amount > 0)
      if (allocs.length > 0) {
        const allocInvoices = await prisma.invoice.findMany({
          where: { id: { in: allocs.map((a) => a.invoiceId) }, tenantId: user.tenantId },
          select: { id: true, clientId: true, balance: true, status: true },
        })
        const byId = new Map(allocInvoices.map((i) => [i.id, i]))
        let sum = 0
        for (const a of allocs) {
          const inv = byId.get(a.invoiceId)
          if (!inv) return NextResponse.json({ error: 'An invoice was not found.' }, { status: 404 })
          if (inv.clientId !== current.clientId) {
            return NextResponse.json({ error: 'All invoices must belong to one customer.' }, { status: 400 })
          }
          if (['CANCELLED', 'REFUNDED'].includes(String(inv.status))) {
            return NextResponse.json({ error: 'An invoice cannot accept payment.' }, { status: 400 })
          }
          if (a.amount > round2(inv.balance) + 0.005) {
            return NextResponse.json({ error: 'An amount exceeds the invoice balance.' }, { status: 400 })
          }
          sum = round2(sum + a.amount)
        }
        if (sum > amount + 0.005) {
          return NextResponse.json({ error: 'Applied amounts exceed the payment total.' }, { status: 400 })
        }
        explicitPlan = allocs
      } else {
        explicitPlan = []
      }
    }

    // Ordered target list for auto-apply: current invoice first, then oldest-first.
    const others = await prisma.invoice.findMany({
      where: {
        clientId: current.clientId,
        tenantId: user.tenantId,
        status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] },
        balance: { gt: 0 },
        id: { not: current.id },
      },
      select: { id: true, invoiceNumber: true },
      orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
    })
    const orderedIds = [current.id, ...others.map((o) => o.id)]

    const paymentMethod =
      method === 'CHECK' ? 'CHECK' : methodLabel.toLowerCase() === 'cash' ? 'CASH' : 'OTHER'
    const provider =
      method === 'QUICK_PAY' ? 'quick_pay' : method === 'OTHER' ? methodLabel.toLowerCase().replace(/\s+/g, '_') : 'manual'
    const notes =
      method === 'CHECK'
        ? 'Payment by check'
        : method === 'QUICK_PAY'
          ? 'Payment by Quick Pay'
          : `Payment — ${methodLabel}`
    const paymentGroupId = `pg_manual_${crypto.randomBytes(12).toString('hex')}`

    const outcome = await prisma.$transaction(async (tx) => {
      const created: Array<{ paymentId: string; invoiceId: string; invoiceNumber: string; applied: number }> = []
      let appliedTotal = 0

      const applyTo = async (invId: string, want: number) => {
        const res = await applyInvoicePayment(
          {
            invoiceId: invId,
            tenantId: user.tenantId,
            amount: want,
            method: paymentMethod as any,
            provider,
            processedAt,
            reference,
            notes,
            paymentGroupId,
          },
          { tx }
        )
        if (res.created && res.paymentId) {
          const row = await tx.payment.findUnique({ where: { id: res.paymentId }, select: { amount: true } })
          const appliedAmt = round2(row?.amount || 0)
          created.push({ paymentId: res.paymentId, invoiceId: invId, invoiceNumber: '', applied: appliedAmt })
          appliedTotal = round2(appliedTotal + appliedAmt)
        }
      }

      if (explicitPlan) {
        for (const a of explicitPlan) {
          await applyTo(a.invoiceId, a.amount)
        }
      } else {
        let remaining = amount
        for (const invId of orderedIds) {
          if (remaining <= 0) break
          await applyTo(invId, remaining)
          remaining = round2(amount - appliedTotal)
        }
      }

      let creditId: string | null = null
      const leftover = round2(amount - appliedTotal)
      if (leftover > 0) {
        const credit = await createOverpaymentCredit(tx, {
          tenantId: user.tenantId,
          clientId: current.clientId,
          amount: leftover,
          sourcePaymentId: created[0]?.paymentId || null,
          sourcePaymentGroupId: paymentGroupId,
          reason: reference ? `Payment (ref ${reference})` : 'Customer payment',
        })
        creditId = credit?.id || null
      }

      return { created, creditId, leftover }
    })

    if (outcome.created.length === 0 && !outcome.creditId) {
      return NextResponse.json({ error: 'Nothing could be recorded for this payment.' }, { status: 400 })
    }

    // Sync the group to QuickBooks (one payment; overpayment shows as unapplied).
    const anchorPaymentId = outcome.created[0]?.paymentId || null
    if (anchorPaymentId) {
      try {
        await enqueueQboSync(user.tenantId, 'payment', anchorPaymentId, { processImmediately: true })
      } catch (error) {
        console.error('QBO sync trigger error (record-payment):', error)
      }
    }

    for (const c of outcome.created) {
      await notifyInvoicePaid(user.tenantId, c.invoiceId, '', c.applied, current.client?.name || 'Customer').catch(() => null)
      await afterInvoicePayment(c.invoiceId).catch(() => null)
    }

    return NextResponse.json({
      ok: true,
      paymentId: anchorPaymentId,
      paymentGroupId,
      creditAmount: outcome.leftover,
    })
  } catch (error) {
    console.error('Record payment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
