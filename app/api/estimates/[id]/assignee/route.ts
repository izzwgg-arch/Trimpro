import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'

// PATCH — set/clear the estimate's assignee. Body: { assignedToId: string | null }.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'estimates.edit')
  if (permError) return permError
  const user = getAuthUser(request)

  try {
    const body = await request.json().catch(() => ({}))
    const raw = body?.assignedToId
    const assignedToId = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null

    const estimate = await prisma.estimate.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!estimate) return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })

    if (assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: { id: assignedToId, tenantId: user.tenantId },
        select: { id: true },
      })
      if (!assignee) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const updated = await prisma.estimate.update({
      where: { id: params.id },
      data: { assignedToId },
      select: { id: true, assignedTo: { select: { id: true, firstName: true, lastName: true } } },
    })
    return NextResponse.json({ estimate: updated })
  } catch (err) {
    console.error('Set estimate assignee error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
