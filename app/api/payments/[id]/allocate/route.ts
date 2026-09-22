import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { reconcilePaymentAllocations } from '@/lib/payments/reconcile-payment'
import { getPaymentView } from '@/lib/payments/payment-view'
import { setQboPaymentLines } from '@/lib/services/qbo-sync'
import { afterInvoicePayment } from '@/lib/payments/after-invoice-payment'

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

    const result = await reconcilePaymentAllocations({
      tenantId: user.tenantId,
      paymentId: params.id,
      allocations: allocations.map((a: any) => ({
        invoiceId: String(a?.invoiceId || ''),
        amount: Number(a?.amount) || 0,
      })),
    })

    // Recompute downstream invoice side-effects.
    for (const invId of result.affectedInvoiceIds) {
      await afterInvoicePayment(invId).catch(() => null)
    }

    // Mirror the new applied lines to the existing QuickBooks payment.
    let qboWarning: string | null = null
    if (qboPaymentId) {
      try {
        await setQboPaymentLines({
          tenantId: user.tenantId,
          qboPaymentId,
          lines: result.qboLines,
        })
      } catch (e: any) {
        qboWarning = e?.message || 'QuickBooks update failed'
        console.error('[allocate] setQboPaymentLines failed:', e)
      }
    }

    const view = await getPaymentView(params.id, user.tenantId)
    return NextResponse.json({ ok: true, payment: view, qboWarning })
  } catch (error: any) {
    const message = error?.message || 'Failed to update payment'
    const clientError =
      message.includes('exceed') ||
      message.includes('same customer') ||
      message.includes('cannot receive') ||
      message.includes('not found')
    console.error('Allocate payment error:', error)
    return NextResponse.json(
      { error: clientError ? message : 'Failed to update payment' },
      { status: clientError ? 400 : 500 }
    )
  }
}
