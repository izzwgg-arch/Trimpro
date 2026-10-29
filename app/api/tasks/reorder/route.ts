import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/authorization'

// POST — set the manual row order of tasks. Body: { ids: string[] } in the new order.
// sortOrder is assigned by index; only tasks in the caller's tenant are touched.
export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'tasks.edit')
  if (permError) return permError

  const user = getAuthUser(request)
  try {
    const body = await request.json().catch(() => ({}))
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : []
    if (ids.length === 0) return NextResponse.json({ error: 'ids are required' }, { status: 400 })

    const owned = await prisma.task.findMany({
      where: { id: { in: ids }, tenantId: user.tenantId },
      select: { id: true },
    })
    const ownedIds = new Set(owned.map((t) => t.id))
    const ordered = ids.filter((id) => ownedIds.has(id))

    await prisma.$transaction(
      ordered.map((id, index) =>
        prisma.task.update({ where: { id }, data: { sortOrder: index } })
      )
    )

    return NextResponse.json({ ok: true, count: ordered.length })
  } catch (err) {
    console.error('Reorder tasks error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
