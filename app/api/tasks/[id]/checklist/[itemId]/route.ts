import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { checklistSelect, cleanChecklistTitle, loadTaskForChecklist } from '@/lib/tasks/checklist'

// PATCH — tick/untick ({ isCompleted }) or rename ({ title }) one item.
export async function PATCH(request: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const { error } = await loadTaskForChecklist(request, params.id, 'change')
  if (error) return error

  try {
    const body = await request.json().catch(() => ({}))
    const data: { title?: string; isCompleted?: boolean } = {}
    if (body?.title !== undefined) {
      const title = cleanChecklistTitle(body.title)
      if (!title) return NextResponse.json({ error: 'Checklist item text is required' }, { status: 400 })
      data.title = title
    }
    if (body?.isCompleted !== undefined) data.isCompleted = Boolean(body.isCompleted)
    const found = await prisma.subtask.findFirst({ where: { id: params.itemId, taskId: params.id }, select: { id: true } })
    if (!found) return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 })
    const item = await prisma.subtask.update({ where: { id: found.id }, data, select: checklistSelect })
    return NextResponse.json({ item })
  } catch (err) {
    console.error('Update checklist item error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE — remove one item.
export async function DELETE(request: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const { error } = await loadTaskForChecklist(request, params.id, 'change')
  if (error) return error

  try {
    const result = await prisma.subtask.deleteMany({ where: { id: params.itemId, taskId: params.id } })
    if (result.count === 0) return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Delete checklist item error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
