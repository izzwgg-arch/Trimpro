import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { notifyIssueAssigned } from '@/lib/notifications'
import { hasMobilePermission, requireMobilePermission, requirePermission } from '@/lib/authorization'
import { applySmartSearch, buildSmartSearchAnd, clientIdentityClauses, ilike } from '@/lib/search/prisma-filters'
import { assignedToUserWhere, teamInclude, teamMemberNameClauses } from '@/lib/assignments/where'
import { defaultRoleForUser, parseTeamInput, primaryAssigneeId, type TeamInput } from '@/lib/assignments/roles'
import { setIssueTeam, validateUsers } from '@/lib/assignments/team-service'
import { andScope, isAssignedOnly, issueScopeWhere } from '@/lib/assignments/scope'

// Helper to detect if request is from mobile app
function isMobileRequest(request: NextRequest): boolean {
  const userAgent = request.headers.get('user-agent') || ''
  const isMobileUA = /Mobile|Android|iPhone|iPad/i.test(userAgent)
  const hasMobileParam = request.nextUrl.searchParams.get('mobile') === 'true'
  return isMobileUA || hasMobileParam
}

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'issues.view')
  if (permError) return permError

  const user = getAuthUser(request)
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const type = searchParams.get('type') || 'all'
  const assigneeId = searchParams.get('assigneeId') || ''
  const scheduledFrom = searchParams.get('scheduledFrom')
  const scheduledTo = searchParams.get('scheduledTo')
  const filter = searchParams.get('filter') || 'all' // all, my, assigned, watched
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const skip = (page - 1) * limit

  try {
    const where: any = {
      tenantId: user.tenantId,
    }
    // "See only assigned ..." restriction: AND it in so no other filter can widen it.
    if (await isAssignedOnly(user, 'issues')) andScope(where, issueScopeWhere(user.id))

    applySmartSearch(
      where,
      buildSmartSearchAnd(search, (term) => [
        { title: ilike(term) },
        { description: ilike(term) },
        ...clientIdentityClauses(term),
        { job: { jobNumber: ilike(term) } },
        { job: { title: ilike(term) } },
        { assignee: { firstName: ilike(term) } },
        { assignee: { lastName: ilike(term) } },
        ...teamMemberNameClauses(ilike, term),
      ])
    )

    if (status !== 'all') {
      where.status = status
    }

    if (type !== 'all') {
      where.type = type
    }

    if (assigneeId) {
      where.AND = where.AND || []
      where.AND.push(assignedToUserWhere(assigneeId))
    }

    if (scheduledFrom || scheduledTo) {
      where.dueDate = {
        ...(scheduledFrom ? { gte: new Date(scheduledFrom) } : {}),
        ...(scheduledTo ? { lte: new Date(scheduledTo) } : {}),
      }
    }

    // Filter: my issues (created by me), assigned to me, watched, or assigned/created combined.
    if (filter === 'my') {
      where.createdById = user.id
    } else if (filter === 'assigned') {
      where.AND = where.AND || []
      where.AND.push(assignedToUserWhere(user.id))
    } else if (filter === 'assigned_or_created') {
      where.AND = where.AND || []
      where.AND.push({
        OR: [
          assignedToUserWhere(user.id),
          { createdById: user.id },
        ],
      })
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
          ...teamInclude,
          assignee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
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
          { dueDate: 'asc' },
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
  const isMobile = isMobileRequest(request)

  // If request is from mobile, enforce mobile permissions
  if (isMobile) {
    const createPermError = await requireMobilePermission(request, 'mobile.issues.create')
    if (createPermError) return createPermError
  } else {
    const permError = await requirePermission(request, 'issues.create')
    if (permError) return permError
  }

  try {
    const body = await request.json()
    const {
      title,
      description,
      type,
      status,
      priority,
      dueDate,
      scheduledAt,
      assigneeId,
      clientId,
      leadId,
      jobId,
      watchers,
    } = body

    const resolvedDueDate = dueDate ?? scheduledAt ?? null

    // The team (site managers / office workers / field workers). The old single
    // `assigneeId` still works; with a team, the primary person is derived from it.
    let team: TeamInput | null = null
    if (body.assignments !== undefined) {
      const parsed = parseTeamInput(body.assignments)
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      team = parsed.team
      const invalid = await validateUsers(user.tenantId, team)
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })
    }
    const resolvedAssigneeId: string | null = team ? primaryAssigneeId(team) : assigneeId || null
    const assigneeIdsToCheck = team ? team.map((t) => t.userId) : resolvedAssigneeId ? [resolvedAssigneeId] : []

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    // If mobile request, check assignment permissions for every person being assigned
    for (const checkId of isMobile ? assigneeIdsToCheck : []) {
      // Verify assignee belongs to tenant
      const assignee = await prisma.user.findFirst({
        where: {
          id: checkId,
          tenantId: user.tenantId,
        },
        select: {
          id: true,
          role: true,
        },
      })

      if (!assignee) {
        return NextResponse.json({ error: 'Assignee not found' }, { status: 404 })
      }

      // Check if assigning to admin
      const isAdmin = assignee.role === 'ADMIN' || assignee.role === 'OFFICE'
      
      // If assigning to admin, require mobile.issues.assign_to_admin or mobile.issues.assign_to_any
      if (isAdmin) {
        const canAssignToAdmin = await hasMobilePermission(user.id, user.tenantId, 'mobile.issues.assign_to_admin')
        const canAssignToAny = await hasMobilePermission(user.id, user.tenantId, 'mobile.issues.assign_to_any')
        
        if (!canAssignToAdmin && !canAssignToAny) {
          return NextResponse.json(
            { error: 'You do not have permission to assign issues to admin users' },
            { status: 403 }
          )
        }
      } else {
        // If assigning to non-admin, require mobile.issues.assign_to_any (admin-level)
        const canAssignToAny = await hasMobilePermission(user.id, user.tenantId, 'mobile.issues.assign_to_any')
        if (!canAssignToAny) {
          return NextResponse.json(
            { error: 'You do not have permission to assign issues to this user' },
            { status: 403 }
          )
        }
      }
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
        dueDate: resolvedDueDate ? new Date(resolvedDueDate) : null,
        assigneeId: resolvedAssigneeId,
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

    // Save the team rows (also for the single-assignee case, so every issue has a team).
    const teamToSave: TeamInput =
      team ?? (issue.assignee ? [{ userId: issue.assignee.id, role: defaultRoleForUser(issue.assignee.role) }] : [])
    let notifyIds: string[] = []
    if (teamToSave.length > 0) {
      const saved = await setIssueTeam(user.tenantId, issue.id, teamToSave)
      if (saved.ok) notifyIds = saved.added
    }

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

    // Notify everyone on the team (except the person who created it)
    for (const notifyId of notifyIds) {
      if (notifyId !== user.id) await notifyIssueAssigned(user.tenantId, notifyId, issue.id, title)
    }

    // Audit log for mobile issue creation
    if (isMobile) {
      await prisma.auditLog.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          action: 'CREATE',
          entityType: 'Issue',
          entityId: issue.id,
          changes: {
            title,
            assigneeId: resolvedAssigneeId,
            assignments: teamToSave,
            source: 'mobile',
          },
        },
      })
    }

    return NextResponse.json({ issue }, { status: 201 })
  } catch (error) {
    console.error('Create issue error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
