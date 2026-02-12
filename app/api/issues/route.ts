import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { notifyIssueAssigned } from '@/lib/notifications'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const type = searchParams.get('type') || 'all'
  const assigneeId = searchParams.get('assigneeId') || ''
  const filter = searchParams.get('filter') || 'all' // all, my, assigned, watched
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
      where.status = status
    }

    if (type !== 'all') {
      where.type = type
    }

    if (assigneeId) {
      where.assigneeId = assigneeId
    }

    // Filter: my issues (created by me), assigned to me, or watched
    if (filter === 'my') {
      where.createdById = user.id
    } else if (filter === 'assigned') {
      where.assigneeId = user.id
    } else if (filter === 'watched') {
      where.watchers = {
        some: {
          userId: user.id,
        },
      }
    }

    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
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
          watchers: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          _count: {
            select: {
              notes: true,
              tasks: true,
            },
          },
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
      }),
      prisma.issue.count({ where }),
    ])

    return NextResponse.json({
      issues,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Get issues error:', error)
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
      type,
      status,
      priority,
      assigneeId,
      clientId,
      leadId,
      jobId,
      watchers,
    } = body

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    let resolvedClientId = clientId || null

    // If created from a job context, enforce issue -> job -> client relational mapping.
    if (jobId) {
      const job = await prisma.job.findFirst({
        where: {
          id: jobId,
          tenantId: user.tenantId,
        },
        select: {
          id: true,
          clientId: true,
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

    // Create issue
    const issue = await prisma.issue.create({
      data: {
        tenantId: user.tenantId,
        title,
        description: description || null,
        type: type || 'OTHER',
        status: status || 'OPEN',
        priority: priority || 'MEDIUM',
        assigneeId: assigneeId || null,
        createdById: user.id,
        clientId: resolvedClientId,
        leadId: leadId || null,
        jobId: jobId || null,
        firstResponseAt: null,
        resolvedAt: null,
        closedAt: null,
      },
      include: {
        assignee: true,
        creator: true,
      },
    })

    // Add watchers
    if (watchers && Array.isArray(watchers)) {
      for (const watcherId of watchers) {
        if (watcherId !== user.id) {
          await prisma.issueWatcher.create({
            data: {
              issueId: issue.id,
              userId: watcherId,
            },
          })
        }
      }
    }

    // Auto-add creator as watcher
    await prisma.issueWatcher.create({
      data: {
        issueId: issue.id,
        userId: user.id,
      },
    })

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'ISSUE_CREATED',
        description: `Issue "${title}" created`,
        issueId: issue.id,
        clientId: resolvedClientId || undefined,
        jobId: jobId || undefined,
      },
    })

    // Notify assignee
    if (assigneeId && assigneeId !== user.id) {
      await notifyIssueAssigned(user.tenantId, assigneeId, issue.id, title)
    }

    return NextResponse.json({ issue }, { status: 201 })
  } catch (error) {
    console.error('Create issue error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
