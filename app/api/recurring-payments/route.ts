import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { recordAuditLog, auditContextFromRequest } from '@/lib/audit/log'

const FREQUENCIES = new Set(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'])

// GET — list recurring payments, optionally filtered by client or invoice (staff only).
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.view')
  if (permError) return permError
  const user = getAuthUser(request)

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId') || undefined
  const invoiceId = searchParams.get('invoiceId') || undefined

  try {
    const items = await prisma.recurringPayment.findMany({
      where: { tenantId: user.tenantId, ...(clientId ? { clientId } : {}), ...(invoiceId ? { invoiceId } : {}) },
      orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }],
      include: {
        card: { select: { maskedCard: true, cardType: true } },
        client: { select: { id: true, name: true } },
        _count: { select: { runs: true } },
      },
    })
    return NextResponse.json({ recurringPayments: items })
  } catch (error) {
    console.error('List recurring payments error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — create a recurring card payment (staff only).
export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.manage')
  if (permError) return permError
  const user = getAuthUser(request)

  try {
    const body = await request.json().catch(() => ({}))
    const type = String(body?.type || 'CARD').toUpperCase() === 'CUSTOM' ? 'CUSTOM' : 'CARD'
    const clientId = String(body?.clientId || '').trim()
    const invoiceId = body?.invoiceId ? String(body.invoiceId).trim() : null
    const cardOnFileId = String(body?.cardOnFileId || '').trim()
    const method = String(body?.method || '').toUpperCase() // CUSTOM only
    const methodLabel = body?.methodLabel ? String(body.methodLabel).trim() : null
    const amount = Math.round(Number(body?.amount) * 100) / 100
    const frequency = String(body?.frequency || '').toUpperCase()
    const startDateRaw = body?.startDate ? new Date(String(body.startDate)) : null
    const endDate = body?.endDate ? new Date(String(body.endDate)) : null
    const maxOccurrences = body?.maxOccurrences != null && body.maxOccurrences !== ''
      ? Math.max(1, parseInt(String(body.maxOccurrences), 10))
      : null
    const notes = body?.notes ? String(body.notes).trim() : null

    const CUSTOM_METHODS = new Set(['CHECK', 'QUICK_PAY', 'OTHER'])

    if (!clientId) return NextResponse.json({ error: 'Customer is required' }, { status: 400 })
    if (!FREQUENCIES.has(frequency)) return NextResponse.json({ error: 'Invalid frequency' }, { status: 400 })
    if (!(amount > 0)) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 })
    if (!startDateRaw || Number.isNaN(startDateRaw.getTime())) {
      return NextResponse.json({ error: 'A valid start date is required' }, { status: 400 })
    }
    if (endDate && !Number.isNaN(endDate.getTime()) && endDate.getTime() < startDateRaw.getTime()) {
      return NextResponse.json({ error: 'End date must be after the start date' }, { status: 400 })
    }

    if (type === 'CARD') {
      if (!cardOnFileId) return NextResponse.json({ error: 'A saved card is required' }, { status: 400 })
      const card = await prisma.cardOnFile.findFirst({
        where: { id: cardOnFileId, tenantId: user.tenantId, clientId, status: 'ACTIVE' },
        select: { id: true },
      })
      if (!card) return NextResponse.json({ error: 'Saved card not found for this customer' }, { status: 404 })
    } else {
      if (!CUSTOM_METHODS.has(method)) {
        return NextResponse.json({ error: 'Payment method must be Check, Quick Pay, or Other' }, { status: 400 })
      }
      if (method === 'OTHER' && !methodLabel) {
        return NextResponse.json({ error: 'Please enter a payment type name.' }, { status: 400 })
      }
    }

    if (invoiceId) {
      const inv = await prisma.invoice.findFirst({
        where: { id: invoiceId, tenantId: user.tenantId, clientId },
        select: { id: true },
      })
      if (!inv) return NextResponse.json({ error: 'Invoice not found for this customer' }, { status: 404 })
    }

    const created = await prisma.recurringPayment.create({
      data: {
        tenantId: user.tenantId,
        clientId,
        invoiceId,
        type,
        cardOnFileId: type === 'CARD' ? cardOnFileId : null,
        method: type === 'CUSTOM' ? method : null,
        methodLabel: type === 'CUSTOM' && method === 'OTHER' ? methodLabel : null,
        amount,
        frequency,
        startDate: startDateRaw,
        nextRunAt: startDateRaw,
        endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : null,
        maxOccurrences,
        notes,
        createdById: user.id,
      },
    })

    void recordAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'CREATE',
      entityType: 'RecurringPayment',
      entityId: created.id,
      changes: { type, clientId, invoiceId, amount, frequency, method: type === 'CUSTOM' ? method : undefined, startDate: startDateRaw },
      ...auditContextFromRequest(request),
    })

    return NextResponse.json({ recurringPayment: created }, { status: 201 })
  } catch (error) {
    console.error('Create recurring payment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
