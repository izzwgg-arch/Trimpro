import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { recordAuditLog, auditContextFromRequest } from '@/lib/audit/log'
import { processRecurringPayment } from '@/lib/payments/recurring'

// GET — one recurring payment with its recent runs (staff only).
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.view')
  if (permError) return permError
  const user = getAuthUser(request)

  const rec = await prisma.recurringPayment.findFirst({
    where: { id: params.id, tenantId: user.tenantId },
    include: {
      card: { select: { maskedCard: true, cardType: true } },
      client: { select: { id: true, name: true } },
      runs: { orderBy: { runAt: 'desc' }, take: 50 },
    },
  })
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ recurringPayment: rec })
}

// PATCH — pause / resume / cancel, or charge now (staff only).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.manage')
  if (permError) return permError
  const user = getAuthUser(request)

  try {
    const rec = await prisma.recurringPayment.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true, status: true },
    })
    if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '').toLowerCase()

    if (action === 'charge_now') {
      if (rec.status !== 'ACTIVE') {
        return NextResponse.json({ error: 'Only active schedules can be charged.' }, { status: 400 })
      }
      const result = await processRecurringPayment(rec.id)
      void recordAuditLog({
        tenantId: user.tenantId, userId: user.id, action: 'UPDATE',
        entityType: 'RecurringPayment', entityId: rec.id,
        changes: { chargeNow: true, outcome: result.status, amount: result.amount, refNum: result.refNum },
        ...auditContextFromRequest(request),
      })
      const ok = result.status === 'SUCCESS'
      return NextResponse.json({ ok, result }, { status: ok ? 200 : 400 })
    }

    const nextStatus =
      action === 'pause' ? 'PAUSED' :
      action === 'resume' ? 'ACTIVE' :
      action === 'cancel' ? 'CANCELLED' :
      null
    if (!nextStatus) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    if (action === 'resume' && rec.status !== 'PAUSED') {
      return NextResponse.json({ error: 'Only a paused schedule can be resumed.' }, { status: 400 })
    }

    const updated = await prisma.recurringPayment.update({
      where: { id: rec.id },
      data: { status: nextStatus, ...(action === 'resume' ? { lastError: null } : {}) },
    })

    void recordAuditLog({
      tenantId: user.tenantId, userId: user.id, action: 'UPDATE',
      entityType: 'RecurringPayment', entityId: rec.id,
      changes: { before: { status: rec.status }, after: { status: nextStatus } },
      ...auditContextFromRequest(request),
    })

    return NextResponse.json({ recurringPayment: updated })
  } catch (error) {
    console.error('Update recurring payment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
