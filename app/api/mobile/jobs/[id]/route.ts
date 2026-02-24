import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireMobilePermission, hasMobilePermission } from '@/lib/authorization'

/**
 * Mobile API: Get single job details
 * - If user has mobile.jobs.view_all: can view any job
 * - Otherwise: can only view jobs assigned to them
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  // Require at least mobile.jobs.view_assigned permission
  const permError = await requireMobilePermission(request, 'mobile.jobs.view_assigned')
  if (permError) return permError

  const user = getAuthUser(request)
  const jobId = params.id

  try {
    // Check if user can view all jobs
    const canViewAll = await hasMobilePermission(user.id, user.tenantId, 'mobile.jobs.view_all')

    const where: any = {
      id: jobId,
      tenantId: user.tenantId,
    }

    // If user doesn't have view_all, only allow viewing assigned jobs
    if (!canViewAll) {
      where.assignments = {
        some: {
          userId: user.id,
        },
      }
    }

    const job = await prisma.job.findFirst({
      where,
      include: {
        client: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        addresses: {
          where: { type: 'job_site' },
          take: 1,
        },
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          take: 1,
        },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const activeSession = await prisma.timeEntry.findFirst({
      where: {
        tenantId: user.tenantId,
        jobId: job.id,
        workerId: user.id,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: {
        id: true,
        startedAt: true,
        createdAt: true,
      },
    })
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todaySummary = await prisma.timeEntry.aggregate({
      where: {
        tenantId: user.tenantId,
        jobId: job.id,
        workerId: user.id,
        status: 'STOPPED',
        deletedAt: null,
        createdAt: { gte: todayStart },
      },
      _sum: {
        durationMinutes: true,
      },
    })

    return NextResponse.json({
      job: {
        id: job.id,
        jobNumber: job.jobNumber,
        title: job.title,
        description: job.description,
        status: job.status,
        priority: job.priority,
        scheduledStart: job.scheduledStart?.toISOString() || null,
        scheduledEnd: job.scheduledEnd?.toISOString() || null,
        chargeByHour: job.chargeByHour,
        hourlyRateCents: job.hourlyRateCents,
        billableMinutesTotal: job.billableMinutesTotal,
        createdAt: job.createdAt.toISOString(),
        client: job.client,
        address: job.addresses[0] || null,
        assignedTo: job.assignments[0]?.user || null,
        currentUserActiveSession: activeSession
          ? {
              id: activeSession.id,
              startedAt: activeSession.startedAt?.toISOString() || activeSession.createdAt.toISOString(),
            }
          : null,
        currentUserTodayMinutes: Number(todaySummary._sum.durationMinutes || 0),
      },
    })
  } catch (error) {
    console.error('Mobile job detail error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
