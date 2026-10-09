import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { recordAuditLog, auditContextFromRequest } from '@/lib/audit/log'

// DELETE — remove a saved card (staff only). Active schedules on it are cancelled.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.manage')
  if (permError) return permError
  const user = getAuthUser(request)

  try {
    const card = await prisma.cardOnFile.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true, maskedCard: true },
    })
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    // Cancel any active recurring schedules bound to this card.
    await prisma.recurringPayment.updateMany({
      where: { cardOnFileId: card.id, status: { in: ['ACTIVE', 'PAUSED'] } },
      data: { status: 'CANCELLED' },
    })

    await prisma.cardOnFile.update({
      where: { id: card.id },
      data: { status: 'REMOVED', isDefault: false },
    })

    void recordAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'DELETE',
      entityType: 'CardOnFile',
      entityId: card.id,
      changes: { maskedCard: card.maskedCard },
      ...auditContextFromRequest(request),
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Remove card error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
