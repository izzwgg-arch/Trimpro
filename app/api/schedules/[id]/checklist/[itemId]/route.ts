import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireAnyPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { guardSchedule } from '@/lib/assignments/scope'

// PATCH — tick/untick a schedule checklist item ({ isCompleted }).
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireAnyPermission(request, ['schedule.view', 'schedule.view_all'])
  if (permError) return permError
  const user = getAuthUser(request)
  const scopeError = await guardSchedule(user, params.id)
  if (scopeError) return scopeError

  try {
    const body = await request.json().catch(() => ({}))
    const item = await prisma.scheduleChecklistItem.findFirst({
      where: { id: params.itemId, scheduleId: params.id, schedule: { tenantId: user.tenantId } },
      select: { id: true },
    })
    if (!item) return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 })

    const updated = await prisma.scheduleChecklistItem.update({
      where: { id: params.itemId },
      data: { isCompleted: Boolean(body?.isCompleted) },
      select: { id: true, title: true, isCompleted: true },
    })
    return NextResponse.json({ item: updated })
  } catch (err) {
    console.error('Toggle schedule checklist item error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
