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
        createdAt: job.createdAt.toISOString(),
        client: job.client,
        address: job.addresses[0] || null,
        assignedTo: job.assignments[0]?.user || null,
      },
    })
  } catch (error) {
    console.error('Mobile job detail error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
