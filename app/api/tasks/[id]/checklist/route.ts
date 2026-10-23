import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { checklistSelect, cleanChecklistTitle, listChecklist, loadTaskForChecklist } from '@/lib/tasks/checklist'

// GET — the task's checklist.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const { error } = await loadTaskForChecklist(request, params.id, 'view')
  if (error) return error
  return NextResponse.json({ items: await listChecklist(params.id) })
}

// POST — add an item ({ title }) at the end of the list.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const { error } = await loadTaskForChecklist(request, params.id, 'change')
  if (error) return error

  try {
    const body = await request.json().catch(() => ({}))
    const title = cleanChecklistTitle(body?.title)
    if (!title) return NextResponse.json({ error: 'Checklist item text is required' }, { status: 400 })
    const last = await prisma.subtask.findFirst({
      where: { taskId: params.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })
    const item = await prisma.subtask.create({
      data: { taskId: params.id, title, sortOrder: (last?.sortOrder ?? -1) + 1 },
      select: checklistSelect,
    })
    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    console.error('Add checklist item error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
