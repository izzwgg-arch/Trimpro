import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'dispatch.view')
  if (permError) return permError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0]

  try {
    const startOfDay = new Date(date)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(date)
    endOfDay.setHours(23, 59, 59, 999)

    const jobs = await prisma.job.findMany({
      where: {
        tenantId: user.tenantId,
        OR: [
          {
            scheduledStart: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
          {
            scheduledStart: null,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
        ],
      },
      include: {
        assignedTo: {
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
        addresses: {
          where: {
            type: 'JOB_SITE',
          },
          take: 1,
        },
      },
      orderBy: [
        { priority: 'desc' },
        { scheduledStart: 'asc' },
      ],
    })

    const formattedJobs = jobs.map((job) => ({
      id: job.id,
      jobNumber: job.jobNumber,
      title: job.title,
      status: job.status,
      priority: job.priority,
      scheduledStart: job.scheduledStart?.toISOString() || null,
      scheduledEnd: job.scheduledEnd?.toISOString() || null,
      assignedTo: job.assignedTo
        ? {
            id: job.assignedTo.id,
            firstName: job.assignedTo.firstName,
            lastName: job.assignedTo.lastName,
          }
        : null,
      client: {
        id: job.client.id,
        name: job.client.name,
      },
      jobSite: job.addresses[0]
        ? {
            street: job.addresses[0].street,
            city: job.addresses[0].city,
            state: job.addresses[0].state,
            zipCode: job.addresses[0].zipCode,
          }
        : null,
    }))

    return NextResponse.json({ jobs: formattedJobs })
  } catch (error) {
    console.error('Dispatch jobs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
