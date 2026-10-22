import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { notifyTaskAssigned, createNotificationsForUsers, formatEntityStatusChangedMessage } from '@/lib/notifications'
import { formatTaskStatus } from '@/lib/tasks/statuses'
import { recordAuditLog, auditContextFromRequest } from '@/lib/audit/log'
import { teamInclude } from '@/lib/assignments/where'
import { defaultRoleForUser, parseTeamInput, type TeamInput } from '@/lib/assignments/roles'
import { setTaskTeam, validateUsers } from '@/lib/assignments/team-service'
import { guardTask } from '@/lib/assignments/scope'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'tasks.view')
  if (permError) return permError

  const user = getAuthUser(request)
  const scopeError = await guardTask(user, params.id)
  if (scopeError) return scopeError

  try {
    const task = await prisma.task.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        ...teamInclude,
        assignee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
          },
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        client: {
          select: {
            id: true,
            name: true,
            companyName: true,
          },
        },
        job: {
          select: {
            id: true,
            jobNumber: true,
            title: true,
          },
        },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            title: true,
          },
        },
        issue: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
        subtasks: {
          orderBy: { sortOrder: 'asc' },
        },
        attachments: {
          orderBy: { createdAt: 'desc' },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json({ task })
  } catch (error) {
    console.error('Get task error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'tasks.edit')
  if (permError) return permError

  const user = getAuthUser(request)
  const scopeError = await guardTask(user, params.id)
  if (scopeError) return scopeError

  try {
    const body = await request.json()
    const {
      title,
      description,
      status,
      priority,
      dueDate,
      scheduledAt,
      assigneeId,
      subtasks,
    } = body

    const resolvedDueDate = dueDate ?? scheduledAt

    // Get existing task
    const existing = await prisma.task.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        assignee: true,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // The team: either sent whole (assignments), or derived from a changed legacy assigneeId.
    let team: TeamInput | null = null
    if (body.assignments !== undefined) {
      const parsed = parseTeamInput(body.assignments)
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      team = parsed.team
      const invalid = await validateUsers(user.tenantId, team)
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })
    } else if (assigneeId && assigneeId !== existing.assigneeId) {
      // Older clients reassign by assigneeId: swap the old primary for the new person, keep the rest.
      const assignee = await prisma.user.findFirst({
        where: {
          id: assigneeId,
          tenantId: user.tenantId,
        },
      })

      if (!assignee) {
        return NextResponse.json({ error: 'Assignee not found' }, { status: 404 })
      }

      const current = await prisma.taskAssignment.findMany({ where: { taskId: existing.id } })
      team = [
        ...current
          .filter((a) => a.userId !== existing.assigneeId && a.userId !== assigneeId)
          .map((a) => ({ userId: a.userId, role: a.role as TeamInput[number]['role'] })),
        { userId: assigneeId, role: defaultRoleForUser(assignee.role) },
      ]
    }

    // Track status change
    const statusChanged = status && status !== existing.status
    const completedAt = status === 'COMPLETED' && existing.status !== 'COMPLETED' ? new Date() : 
                        status !== 'COMPLETED' && existing.status === 'COMPLETED' ? null : 
                        existing.completedAt

    // Update task
    const task = await prisma.task.update({
      where: { id: params.id },
      data: {
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
        status: status !== undefined ? status : existing.status,
        priority: priority !== undefined ? priority : existing.priority,
        dueDate:
          resolvedDueDate !== undefined ? (resolvedDueDate ? new Date(resolvedDueDate) : null) : existing.dueDate,
        // With a team, setTaskTeam below sets the primary assignee.
        assigneeId: team ? existing.assigneeId : assigneeId !== undefined ? (assigneeId || null) : existing.assigneeId,
        completedAt,
      },
      include: {
        assignee: true,
        creator: true,
      },
    })

    // Save the team and notify anyone newly added.
    let teamSaved: Awaited<ReturnType<typeof setTaskTeam>> | null = null
    if (team) {
      teamSaved = await setTaskTeam(user.tenantId, existing.id, team)
      if (teamSaved.ok) {
        for (const addedId of teamSaved.added) {
          await notifyTaskAssigned(user.tenantId, addedId, existing.id, existing.title)
        }
      }
    }

    // Update subtasks if provided
    if (subtasks && Array.isArray(subtasks)) {
      await prisma.subtask.deleteMany({
        where: { taskId: params.id },
      })

      for (let i = 0; i < subtasks.length; i++) {
        await prisma.subtask.create({
          data: {
            taskId: params.id,
            title: subtasks[i].title,
            isCompleted: subtasks[i].isCompleted || false,
            sortOrder: i,
          },
        })
      }
    }

    // Record who edited the task (captures any field change, not just status).
    void recordAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'UPDATE',
      entityType: 'Task',
      entityId: task.id,
      changes: {
        before: {
          title: existing.title,
          status: existing.status,
          priority: existing.priority,
          assignee: existing.assignee ? `${existing.assignee.firstName || ''} ${existing.assignee.lastName || ''}`.trim() || existing.assignee.email : null,
          dueDate: existing.dueDate,
        },
        after: {
          title: task.title,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee ? `${task.assignee.firstName || ''} ${task.assignee.lastName || ''}`.trim() || task.assignee.email : null,
          dueDate: task.dueDate,
        },
      },
      ...auditContextFromRequest(request),
    })

    // Create activity for status change
    if (statusChanged) {
      await prisma.activity.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: status === 'COMPLETED' ? 'TASK_COMPLETED' : 'TASK_CREATED',
          description: `Task "${task.title}" ${status === 'COMPLETED' ? 'completed' : `status changed to ${status}`}`,
          taskId: task.id,
          clientId: task.clientId || undefined,
          jobId: task.jobId || undefined,
        },
      })
    }

    // Notify the team about any update (including status changes and other field updates)
    const teamRows = await prisma.taskAssignment.findMany({ where: { taskId: task.id }, select: { userId: true } })
    const notifyUserIds = Array.from(
      new Set([...teamRows.map((r) => r.userId), ...(teamSaved?.ok ? teamSaved.primaryAssigneeId ? [teamSaved.primaryAssigneeId] : [] : task.assigneeId ? [task.assigneeId] : [])])
    )
    if (notifyUserIds.length > 0) {
      let notificationTitle = 'Task Updated'
      let notificationMessage = `"${task.title}" has been updated`

      if (statusChanged) {
        notificationTitle = 'Task Update'
        notificationMessage = formatEntityStatusChangedMessage({
          entityType: 'Task',
          entityNumber: task.id.slice(-8).toUpperCase(),
          entityName: task.title,
          oldStatusLabel: formatTaskStatus(existing.status),
          newStatusLabel: formatTaskStatus(status),
        })
      }

      await createNotificationsForUsers(user.tenantId, notifyUserIds, {
        type: 'TASK_UPDATED',
        title: notificationTitle,
        message: notificationMessage,
        linkType: 'task',
        linkId: task.id,
        linkUrl: `/dashboard/tasks/${task.id}`,
        actorUserId: user.id,
        action: statusChanged ? 'status_changed' : 'task_updated',
      })
    }

    const withTeam = await prisma.task.findFirst({
      where: { id: task.id },
      include: { ...teamInclude, assignee: true, creator: true },
    })
    return NextResponse.json({ task: withTeam || task })
  } catch (error) {
    console.error('Update task error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'tasks.delete')
  if (permError) return permError

  const user = getAuthUser(request)
  const scopeError = await guardTask(user, params.id)
  if (scopeError) return scopeError

  try {
    const task = await prisma.task.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    await prisma.task.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ message: 'Task deleted successfully' })
  } catch (error) {
    console.error('Delete task error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
