import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/middleware'
import { hasPermission } from '@/lib/authorization'
import { guardTask } from '@/lib/assignments/scope'
import { assignedToUserWhere } from '@/lib/assignments/where'

/**
 * Task checklist (stored as the task's subtasks). Anyone who can view the task can
 * see it; people who can edit tasks — or who are on the task's team — can tick,
 * add, rename and remove items.
 */
export async function loadTaskForChecklist(request: NextRequest, taskId: string, mode: 'view' | 'change') {
  const user = getAuthUser(request)
  if (!(await hasPermission(user.id, user.tenantId, 'tasks.view'))) {
    return { error: NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 }) }
  }
  const scopeError = await guardTask(user, taskId)
  if (scopeError) return { error: scopeError }
  const task = await prisma.task.findFirst({ where: { id: taskId, tenantId: user.tenantId }, select: { id: true } })
  if (!task) return { error: NextResponse.json({ error: 'Task not found' }, { status: 404 }) }

  if (mode === 'change' && !(await hasPermission(user.id, user.tenantId, 'tasks.edit'))) {
    const onTeam = await prisma.task.findFirst({
      where: { id: taskId, ...assignedToUserWhere(user.id) },
      select: { id: true },
    })
    if (!onTeam) {
      return { error: NextResponse.json({ error: 'Only people on this task can change its checklist' }, { status: 403 }) }
    }
  }
  return { task, user }
}

export const checklistSelect = { id: true, title: true, isCompleted: true, sortOrder: true } as const

export function listChecklist(taskId: string) {
  return prisma.subtask.findMany({
    where: { taskId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: checklistSelect,
  })
}

export const cleanChecklistTitle = (value: unknown) => String(value ?? '').trim().slice(0, 300)
