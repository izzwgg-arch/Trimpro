import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { validateQuery, dateRangeSchema } from '@/lib/validation'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'analytics.view')
  if (permError) return permError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)

  // Validate query params
  const validation = validateQuery(searchParams, dateRangeSchema)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  const startDate = validation.data.startDate
    ? new Date(validation.data.startDate)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const endDate = validation.data.endDate ? new Date(validation.data.endDate) : new Date()

  try {
    // Jobs by status over time (daily breakdown)
    const jobsByStatus = await prisma.job.groupBy({
      by: ['status', 'createdAt'],
      where: {
        tenantId: user.tenantId,
        createdAt: { gte: startDate, lte: endDate },
      },
    })

    // Jobs by category/service type
    const jobsByCategory = await prisma.job.groupBy({
      by: ['category'],
      where: {
        tenantId: user.tenantId,
        createdAt: { gte: startDate, lte: endDate },
      },
      _count: true,
    })

    // Job completion time distribution
    const completedJobs = await prisma.job.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'COMPLETED',
        createdAt: { gte: startDate, lte: endDate },
        actualEnd: { not: null },
        scheduledStart: { not: null },
      },
      select: {
        createdAt: true,
        scheduledStart: true,
        actualEnd: true,
      },
    })

    const completionTimes = completedJobs.map((job) => {
      const scheduled = job.scheduledStart!.getTime()
      const completed = job.actualEnd!.getTime()
      return Math.round((completed - scheduled) / (1000 * 60 * 60)) // Hours
    })

    // Job rework rate (jobs with issues)
    const jobsWithIssues = await prisma.job.count({
      where: {
        tenantId: user.tenantId,
        createdAt: { gte: startDate, lte: endDate },
        issues: {
          some: {},
        },
      },
    })

    const totalJobs = await prisma.job.count({
      where: {
        tenantId: user.tenantId,
        createdAt: { gte: startDate, lte: endDate },
      },
    })

    const reworkRate = totalJobs > 0 ? (jobsWithIssues / totalJobs) * 100 : 0

    // Time series data for charts (group by day)
    const dailyJobs = await prisma.$queryRaw<Array<{ date: Date; count: bigint; status: string }>>`
      SELECT 
        DATE(created_at) as date,
        status,
        COUNT(*)::int as count
      FROM jobs
      WHERE tenant_id = ${user.tenantId}
        AND created_at >= ${startDate}
        AND created_at <= ${endDate}
      GROUP BY DATE(created_at), status
      ORDER BY date ASC
    `

    return NextResponse.json({
      metrics: {
        jobsByStatus: jobsByStatus.map((j) => ({
          status: j.status,
          date: j.createdAt.toISOString(),
          count: 1,
        })),
        jobsByCategory: jobsByCategory.map((j) => ({
          category: j.category || 'Uncategorized',
          count: j._count,
        })),
        completionTimeDistribution: {
          average: completionTimes.length > 0
            ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
            : 0,
          min: completionTimes.length > 0 ? Math.min(...completionTimes) : 0,
          max: completionTimes.length > 0 ? Math.max(...completionTimes) : 0,
          distribution: completionTimes,
        },
        reworkRate: Math.round(reworkRate * 100) / 100,
        dailyTimeSeries: dailyJobs.map((d) => ({
          date: d.date.toISOString().split('T')[0],
          status: d.status,
          count: Number(d.count),
        })),
      },
    })
  } catch (error) {
    console.error('Analytics jobs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
