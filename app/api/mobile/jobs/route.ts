import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { getPaginationParams, createPaginationResponse } from '@/lib/pagination'

/**
 * Mobile API: Get jobs assigned to the authenticated user
 * Optimized for mobile with minimal payload
 */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'jobs.view')
  if (permError) return permError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const { skip, take, limit, offset } = getPaginationParams(searchParams)

  try {
    const where: any = {
      tenantId: user.tenantId,
      assignedToId: user.id,
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

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        jobNumber: job.jobNumber,
        title: job.title,
        status: job.status,
        priority: job.priority,
        scheduledStart: job.scheduledStart?.toISOString() || null,
        scheduledEnd: job.scheduledEnd?.toISOString() || null,
        createdAt: job.createdAt.toISOString(),
        client: job.client,
        address: job.addresses[0] || null,
      })),
      pagination: createPaginationResponse(total, limit, offset),
    })
  } catch (error) {
    console.error('Mobile jobs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
