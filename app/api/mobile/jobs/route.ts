import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireMobilePermission, hasMobilePermission } from '@/lib/authorization'
import { getPaginationParams, createPaginationResponse } from '@/lib/pagination'

/**
 * Mobile API: Get jobs
 * Query:
 * - filter=assigned (default): only jobs assigned to the current user
 * - filter=all: all org jobs (requires mobile.jobs.view_all)
 * Optimized for mobile with minimal payload
 */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  // Require at least mobile.jobs.view_assigned permission
  const permError = await requireMobilePermission(request, 'mobile.jobs.view_assigned')
  if (permError) return permError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const filterRaw = (searchParams.get('filter') || 'assigned').toLowerCase()
  const filter = filterRaw === 'all' ? 'all' : 'assigned'
  const { skip, take, limit, offset } = getPaginationParams(searchParams)

  try {
    const canViewAll = await hasMobilePermission(user.id, user.tenantId, 'mobile.jobs.view_all')

    if (filter === 'all' && !canViewAll) {
      return NextResponse.json(
        { error: 'You do not have permission to view all jobs' },
        { status: 403 }
      )
    }

    const where: any = {
      tenantId: user.tenantId,
    }

    // Jobs tab always uses assigned; All Jobs (sidebar) uses filter=all when permitted.
    if (filter === 'assigned' || !canViewAll) {
      where.assignments = {
        some: {
          userId: user.id,
        },
      }
    }

    if (status) {
      where.status = status
    }

    const jobs = await prisma.job.findMany({
      where,
      select: {
        id: true,
        jobNumber: true,
        title: true,
        status: true,
        priority: true,
        scheduledStart: true,
        scheduledEnd: true,
        chargeByHour: true,
        hourlyRateCents: true,
        billableMinutesTotal: true,
        createdAt: true,
        client: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        addresses: {
          where: { type: 'JOB_SITE' },
          take: 1,
          select: {
            street: true,
            city: true,
            state: true,
            zipCode: true,
          },
        },
      },
      orderBy: {
        scheduledStart: 'asc',
      },
      take,
      skip,
    })

    const total = await prisma.job.count({ where })

    const jobIds = jobs.map((j) => j.id)
    const activeByJob = jobIds.length
      ? await prisma.timeEntry.findMany({
          where: {
            tenantId: user.tenantId,
            workerId: user.id,
            jobId: { in: jobIds },
            status: 'ACTIVE',
            deletedAt: null,
          },
          select: {
            id: true,
            jobId: true,
            startedAt: true,
            createdAt: true,
          },
        })
      : []

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayTotals = jobIds.length
      ? await prisma.timeEntry.groupBy({
          by: ['jobId'],
          where: {
            tenantId: user.tenantId,
            workerId: user.id,
            jobId: { in: jobIds },
            deletedAt: null,
            status: 'STOPPED',
            createdAt: { gte: todayStart },
          },
          _sum: {
            durationMinutes: true,
          },
        })
      : []
    const activeMap = new Map(activeByJob.map((row) => [row.jobId, row]))
    const todayMap = new Map(todayTotals.map((row) => [row.jobId, Number(row._sum.durationMinutes || 0)]))

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        jobNumber: job.jobNumber,
        title: job.title,
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
        currentUserActiveSession: activeMap.get(job.id)
          ? {
              id: activeMap.get(job.id)!.id,
              startedAt: activeMap.get(job.id)!.startedAt?.toISOString() || activeMap.get(job.id)!.createdAt.toISOString(),
            }
          : null,
        currentUserTodayMinutes: todayMap.get(job.id) || 0,
      })),
      pagination: createPaginationResponse(total, limit, offset),
    })
  } catch (error) {
    console.error('Mobile jobs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
