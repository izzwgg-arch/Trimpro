import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { isMobileRequest, requireMobilePermission, requirePermission } from '@/lib/authorization'
import { notifyJobAssigned } from '@/lib/notifications'
import { defaultRoleForUser, isAssignmentRole, parseTeamInput } from '@/lib/assignments/roles'
import { setJobTeam } from '@/lib/assignments/team-service'
import { guardJob } from '@/lib/assignments/scope'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'jobs.assign')
  if (permError) return permError

  const user = getAuthUser(request)
  const scopeError = await guardJob(user, params.id)
  if (scopeError) return scopeError

  try {
    // Verify job belongs to tenant
    const job = await prisma.job.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const assignments = await prisma.jobAssignment.findMany({
      where: { jobId: params.id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ assignments })
  } catch (error) {
    console.error('Get assignments error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const scopeError = await guardJob(user, params.id)
  if (scopeError) return scopeError
  const isMobile = isMobileRequest(request)

  if (isMobile) {
    const permError = await requireMobilePermission(request, 'mobile.jobs.assign')
    if (permError) return permError
  } else {
    const permError = await requirePermission(request, 'jobs.assign')
    if (permError) return permError
  }

  try {
    const body = await request.json()
    const { userId, role, notes } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    // Verify job belongs to tenant
    const job = await prisma.job.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Verify user belongs to tenant
    const assignee = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId: user.tenantId,
      },
    })

    if (!assignee) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check if already assigned
    const existing = await prisma.jobAssignment.findUnique({
      where: {
        jobId_userId: {
          jobId: params.id,
          userId,
        },
      },
    })

    if (existing) {
      return NextResponse.json({ error: 'User already assigned to this job' }, { status: 400 })
    }

    const assignment = await prisma.jobAssignment.create({
      data: {
        jobId: params.id,
        userId,
        role: isAssignmentRole(role) ? role : defaultRoleForUser(assignee.role),
        notes: notes || null,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
          },
        },
      },
    })

    await notifyJobAssigned(user.tenantId, userId, job.id, job.title)

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'JOB_STATUS_CHANGED',
        description: `${assignee.firstName} ${assignee.lastName} assigned to job "${job.title}"`,
        jobId: job.id,
        clientId: job.clientId,
      },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'UPDATE',
        entityType: 'JobAssignment',
        entityId: assignment.id,
        changes: {
          jobId: job.id,
          assignedUserId: userId,
          source: isMobile ? 'mobile' : 'web',
        },
      },
    })

    return NextResponse.json({ assignment }, { status: 201 })
  } catch (error) {
    console.error('Create assignment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'jobs.assign')
  if (permError) return permError

  const user = getAuthUser(request)
  const scopeError = await guardJob(user, params.id)
  if (scopeError) return scopeError
  const searchParams = request.nextUrl.searchParams
  const userId = searchParams.get('userId')

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
  }

  try {
    // Verify job belongs to tenant
    const job = await prisma.job.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    await prisma.jobAssignment.deleteMany({
      where: {
        jobId: params.id,
        userId,
      },
    })

    return NextResponse.json({ message: 'Assignment removed successfully' })
  } catch (error) {
    console.error('Delete assignment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT — replace the job's whole team in one call: { assignments: [{ userId, role }] }
// where role is SITE_MANAGER | OFFICE_WORKER | FIELD_WORKER.
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const scopeError = await guardJob(user, params.id)
  if (scopeError) return scopeError
  const isMobile = isMobileRequest(request)

  if (isMobile) {
    const permError = await requireMobilePermission(request, 'mobile.jobs.assign')
    if (permError) return permError
  } else {
    const permError = await requirePermission(request, 'jobs.assign')
    if (permError) return permError
  }

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = parseTeamInput(body?.assignments)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const job = await prisma.job.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true, title: true, clientId: true },
    })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const result = await setJobTeam(user.tenantId, params.id, parsed.team)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    for (const addedId of result.added) {
      await notifyJobAssigned(user.tenantId, addedId, job.id, job.title)
    }

    if (result.added.length > 0 || result.removed.length > 0) {
      await prisma.activity.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: 'JOB_STATUS_CHANGED',
          description: `Team updated on job "${job.title}" (${result.added.length} added, ${result.removed.length} removed)`,
          jobId: job.id,
          clientId: job.clientId,
        },
      })
    }

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'UPDATE',
        entityType: 'JobAssignment',
        entityId: job.id,
        changes: {
          jobId: job.id,
          team: parsed.team,
          added: result.added,
          removed: result.removed,
          source: isMobile ? 'mobile' : 'web',
        },
      },
    })

    const assignments = await prisma.jobAssignment.findMany({
      where: { jobId: params.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ assignments })
  } catch (error) {
    console.error('Set job team error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
