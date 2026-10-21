import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { reconcilePaymentAllocations, type PaymentEditFields } from '@/lib/payments/reconcile-payment'
import { getPaymentView } from '@/lib/payments/payment-view'
import { setQboPaymentLines } from '@/lib/services/qbo-sync'
import { afterInvoicePayment } from '@/lib/payments/after-invoice-payment'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'

const UI_METHODS = new Set(['CHECK', 'QUICK_PAY', 'OTHER'])

/**
 * Save a payment edit in one atomic step: amount received, date, reference,
 * method and how it is applied across the customer's invoices. Can be called
 * any number of times — the payment is always re-derived from this request.
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
    const allocations = Array.isArray(body?.allocations) ? body.allocations : null
    if (!allocations) {
      return NextResponse.json({ error: 'allocations must be an array' }, { status: 400 })
    }

    const fields: PaymentEditFields = {}
    if (body?.reference !== undefined) fields.reference = String(body.reference || '').trim() || null
    if (body?.paidAt) {
      const d = new Date(String(body.paidAt))
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Please enter a valid payment date' }, { status: 400 })
      }
      fields.paidAt = d
    }
    if (body?.method) {
      const method = String(body.method).trim().toUpperCase()
      if (!UI_METHODS.has(method)) {
        return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 })
      }
      fields.method = method as PaymentEditFields['method']
      fields.methodLabel = String(body?.methodLabel || '').trim()
    }

    let totalReceived: number | undefined
    if (body?.totalReceived !== undefined && body?.totalReceived !== null && body?.totalReceived !== '') {
      totalReceived = Number(body.totalReceived)
      if (!Number.isFinite(totalReceived)) {
        return NextResponse.json({ error: 'Please enter a valid amount received' }, { status: 400 })
      }
    }

    // Resolve the QBO payment id (stable across reconcile) from the current
    // group members' sync logs, before we mutate rows.
    const trigger = await prisma.payment.findFirst({
      where: { id: params.id, invoice: { tenantId: user.tenantId } },
      select: { id: true, paymentGroupId: true },
    })
    if (!trigger) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    const memberIds = trigger.paymentGroupId
      ? (
          await prisma.payment.findMany({
            where: { paymentGroupId: trigger.paymentGroupId },
            select: { id: true },
          })
        ).map((p) => p.id)
      : [trigger.id]
    const mapLog = await prisma.quickBooksSyncLog.findFirst({
      where: { type: 'payment', entityId: { in: memberIds }, status: 'success', qboId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { qboId: true },
    })
    const qboPaymentId = mapLog?.qboId || null

    const before = await getPaymentView(params.id, user.tenantId)

    const result = await reconcilePaymentAllocations({
      tenantId: user.tenantId,
      paymentId: params.id,
      allocations: allocations.map((a: any) => ({
        invoiceId: String(a?.invoiceId || ''),
        amount: Number(a?.amount) || 0,
      })),
      totalReceived,
      fields,
    })

    // Recompute downstream invoice side-effects.
    for (const invId of result.affectedInvoiceIds) {
      await afterInvoicePayment(invId).catch(() => null)
    }

    const view = await getPaymentView(params.id, user.tenantId)

    const snapshot = (v: typeof view) =>
      v
        ? {
            totalReceived: v.totalReceived,
            unapplied: v.unapplied,
            reference: v.reference,
            paidAt: v.paidAt,
            method: v.methodLabel,
            applied: v.lines.map((l) => ({ invoice: l.invoiceNumber, amount: l.amount })),
          }
        : null
    await prisma.auditLog
      .create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          action: 'UPDATE',
          entityType: 'Payment',
          entityId: params.id,
          ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
          userAgent: request.headers.get('user-agent') || undefined,
          changes: { before: snapshot(before), after: snapshot(view) } as any,
        },
      })
      .catch((e) => console.error('[allocate] audit log failed:', e))

    // Mirror the full edit to QuickBooks, or queue a create if it was never synced.
    let qboWarning: string | null = null
    if (qboPaymentId) {
      try {
        await setQboPaymentLines({
          tenantId: user.tenantId,
          qboPaymentId,
          lines: result.qboLines,
          edit: { paymentId: params.id, totalReceived: result.totalReceived },
        })
      } catch (e: any) {
        qboWarning = e?.message || 'QuickBooks update failed'
        console.error('[allocate] setQboPaymentLines failed:', e)
      }
    } else {
      try {
        await enqueueQboSync(user.tenantId, 'payment', params.id)
      } catch (e) {
        console.error('[allocate] QuickBooks sync trigger error:', e)
      }
    }

    return NextResponse.json({ ok: true, payment: view, qboWarning })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json(
        { error: 'Another payment on one of these invoices already uses that reference number. Please use a different one.' },
        { status: 400 }
      )
    }
    const message = error?.message || 'Failed to update payment'
    const clientError =
      message.includes('exceed') ||
      message.includes('same customer') ||
      message.includes('cannot receive') ||
      message.includes('cannot change') ||
      message.includes('not found') ||
      message.startsWith('Please ')
    console.error('Allocate payment error:', error)
    return NextResponse.json(
      { error: clientError ? message : 'Failed to update payment' },
      { status: clientError ? 400 : 500 }
    )
  }
}
