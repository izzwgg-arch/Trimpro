import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { listChecklist, loadTaskForChecklist } from '@/lib/tasks/checklist'

// POST — reorder checklist items. Body: { ids: string[] } in the new order.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const { error } = await loadTaskForChecklist(request, params.id, 'change')
  if (error) return error

  try {
    const body = await request.json().catch(() => ({}))
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : []
    if (ids.length === 0) return NextResponse.json({ error: 'ids are required' }, { status: 400 })

    // Only reorder items that actually belong to this task.
    const owned = await prisma.subtask.findMany({
      where: { taskId: params.id, id: { in: ids } },
      select: { id: true },
    })
    const ownedIds = new Set(owned.map((s) => s.id))
    const ordered = ids.filter((id) => ownedIds.has(id))

    await prisma.$transaction(
      ordered.map((id, index) =>
        prisma.subtask.update({ where: { id }, data: { sortOrder: index } })
      )
    )

    return NextResponse.json({ items: await listChecklist(params.id) })
  } catch (err) {
    console.error('Reorder checklist error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
