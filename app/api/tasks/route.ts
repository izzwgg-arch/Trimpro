import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { notifyTaskAssigned } from '@/lib/notifications'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const assigneeId = searchParams.get('assigneeId') || ''
  const filter = searchParams.get('filter') || 'all' // all, my, assigned
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const skip = (page - 1) * limit

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status !== 'all') {
      if (status === 'PLANNING_PENDING') {
        where.status = { in: ['TODO', 'IN_PROGRESS'] }
      } else {
        where.status = status
      }
    }

    if (assigneeId) {
      where.assigneeId = assigneeId
    }

    // Filter: my tasks (created by me) or assigned to me
    if (filter === 'my') {
      where.OR = [
        { createdById: user.id },
        { assigneeId: user.id },
      ]
    } else if (filter === 'assigned') {
      where.assigneeId = user.id
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: {
          assignee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
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
            },
          },
          issue: {
            select: {
              id: true,
              title: true,
            },
          },
          subtasks: {
            orderBy: { sortOrder: 'asc' },
          },
          _count: {
            select: {
              subtasks: true,
            },
          },
        },
        orderBy: [
          { priority: 'desc' },
          { dueDate: 'asc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
      }),
      prisma.task.count({ where }),
    ])

    return NextResponse.json({
      tasks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Get tasks error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const {
      title,
      description,
      status,
      priority,
      dueDate,
      assigneeId,
      clientId,
      leadId,
      jobId,
      invoiceId,
      issueId,
      callId,
      smsId,
      subtasks,
    } = body

    if (!title || !assigneeId) {
      return NextResponse.json({ error: 'Title and assignee are required' }, { status: 400 })
    }

    let resolvedClientId = clientId || null

    // If a task is created from a job context, enforce relational linkage to that job/client.
    if (jobId) {
      const job = await prisma.job.findFirst({
        where: {
          id: jobId,
          tenantId: user.tenantId,
        },
        select: {
          id: true,
          clientId: true,
          jobNumber: true,
          title: true,
        },
      })

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      resolvedClientId = job.clientId
    }

    if (resolvedClientId) {
      const client = await prisma.client.findFirst({
        where: {
          id: resolvedClientId,
          tenantId: user.tenantId,
        },
        select: { id: true },
      })

      if (!client) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }
    }

    // Verify assignee belongs to tenant
    const assignee = await prisma.user.findFirst({
      where: {
        id: assigneeId,
        tenantId: user.tenantId,
      },
    })

    if (!assignee) {
      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 })
    }

    // Create task
    const task = await prisma.task.create({
      data: {
        tenantId: user.tenantId,
        title,
        description: description || null,
        status: status || 'TODO',
        priority: priority || 'MEDIUM',
        dueDate: dueDate ? new Date(dueDate) : null,
        assigneeId,
        createdById: user.id,
        clientId: resolvedClientId,
        leadId: leadId || null,
        jobId: jobId || null,
        invoiceId: invoiceId || null,
        issueId: issueId || null,
      },
      include: {
        assignee: true,
        creator: true,
      },
    })

    // Create subtasks if provided
    if (subtasks && Array.isArray(subtasks)) {
      for (let i = 0; i < subtasks.length; i++) {
        await prisma.subtask.create({
          data: {
            taskId: task.id,
            title: subtasks[i].title,
            sortOrder: i,
          },
        })
      }
    }

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'TASK_CREATED',
        description: `Task "${title}" assigned to ${assignee.firstName} ${assignee.lastName}`,
        taskId: task.id,
        clientId: resolvedClientId || undefined,
        jobId: jobId || undefined,
        invoiceId: invoiceId || undefined,
        issueId: issueId || undefined,
      },
    })

    // Notify assignee
    await notifyTaskAssigned(user.tenantId, assigneeId, task.id, title)

    return NextResponse.json({ task }, { status: 201 })
  } catch (error) {
    console.error('Create task error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
