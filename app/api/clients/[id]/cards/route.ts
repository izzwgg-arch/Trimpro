import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { recordAuditLog, auditContextFromRequest } from '@/lib/audit/log'
import { saveCardFromIfieldsToken, cardknoxConfigured } from '@/lib/services/cardknox-gateway'

// GET — list a client's saved cards (staff only).
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.view')
  if (permError) return permError
  const user = getAuthUser(request)

  try {
    const client = await prisma.client.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const cards = await prisma.cardOnFile.findMany({
      where: { tenantId: user.tenantId, clientId: params.id, status: 'ACTIVE' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        maskedCard: true,
        cardType: true,
        expMonth: true,
        expYear: true,
        label: true,
        isDefault: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ cards, gatewayConfigured: cardknoxConfigured() })
  } catch (error) {
    console.error('List cards error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — vault a card from an iFields one-time token (staff only). The raw card
// never reaches us; the browser tokenizes it with Cardknox iFields first.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.manage')
  if (permError) return permError
  const user = getAuthUser(request)

  try {
    if (!cardknoxConfigured()) {
      return NextResponse.json({ error: 'Card processing is not configured.' }, { status: 400 })
    }
    const client = await prisma.client.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const cardToken = String(body?.cardToken || '').trim()
    const exp = String(body?.exp || '').replace(/\D/g, '')
    const cvvToken = body?.cvvToken ? String(body.cvvToken).trim() : undefined
    const label = body?.label ? String(body.label).trim() : null
    const makeDefault = body?.isDefault === true

    if (!cardToken) return NextResponse.json({ error: 'Missing card token' }, { status: 400 })
    if (exp.length !== 4) return NextResponse.json({ error: 'Card expiration is required (MMYY)' }, { status: 400 })

    const saved = await saveCardFromIfieldsToken({ cardToken, exp, cvvToken, name: undefined })
    if (!saved.token) {
      return NextResponse.json({ error: 'Gateway did not return a card token.' }, { status: 502 })
    }

    const hasDefault = await prisma.cardOnFile.count({
      where: { tenantId: user.tenantId, clientId: params.id, status: 'ACTIVE', isDefault: true },
    })
    const isDefault = makeDefault || hasDefault === 0

    if (isDefault) {
      await prisma.cardOnFile.updateMany({
        where: { tenantId: user.tenantId, clientId: params.id, isDefault: true },
        data: { isDefault: false },
      })
    }

    const card = await prisma.cardOnFile.create({
      data: {
        tenantId: user.tenantId,
        clientId: params.id,
        token: saved.token,
        maskedCard: saved.maskedCard,
        cardType: saved.cardType,
        expMonth: saved.expMonth,
        expYear: saved.expYear,
        label,
        isDefault,
        createdById: user.id,
      },
      select: {
        id: true, maskedCard: true, cardType: true, expMonth: true, expYear: true, label: true, isDefault: true,
      },
    })

    void recordAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'CREATE',
      entityType: 'CardOnFile',
      entityId: card.id,
      changes: { clientId: params.id, maskedCard: card.maskedCard, cardType: card.cardType },
      ...auditContextFromRequest(request),
    })

    return NextResponse.json({ card }, { status: 201 })
  } catch (error: any) {
    console.error('Save card error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to save card' }, { status: 500 })
  }
}
