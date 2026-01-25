import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getPaginationParams, createPaginationResponse } from '@/lib/pagination'
import { validateRequest, createJobSchema } from '@/lib/validation'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const clientId = searchParams.get('clientId') || ''
  const { skip, take, page, limit } = getPaginationParams(searchParams)

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (search) {
      where.OR = [
        { jobNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status !== 'all') {
      where.status = status
    }

    if (clientId) {
      where.clientId = clientId
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: {
          client: {
            select: {
              id: true,
              name: true,
              companyName: true,
            },
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
          },
          _count: {
            select: {
              tasks: true,
              issues: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        skip,
        take,
      }),
      prisma.job.count({ where }),
    ])

    return NextResponse.json({
      jobs,
      pagination: createPaginationResponse(total, limit, skip),
    })
  } catch (error) {
    console.error('Get jobs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  // Validate request body
  const validation = await validateRequest(request, createJobSchema)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  const {
    clientId,
    title,
    description,
    status,
    priority,
    scheduledStart,
    scheduledEnd,
    estimateAmount,
    jobSite,
  } = validation.data

  try {

    // Verify client belongs to tenant
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        tenantId: user.tenantId,
      },
    })

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Generate job number
    const jobCount = await prisma.job.count({
      where: { tenantId: user.tenantId },
    })
    const jobNumber = `JOB-${String(jobCount + 1).padStart(6, '0')}`

    // Create job
    const job = await prisma.job.create({
      data: {
        tenantId: user.tenantId,
        clientId,
        jobNumber,
        title,
        description: description || null,
        status: status || 'QUOTE',
        priority: typeof priority === 'number' ? priority : (priority ? parseInt(String(priority)) : 3),
        scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
        estimateAmount: estimateAmount ? (typeof estimateAmount === 'string' ? parseFloat(estimateAmount) : estimateAmount) : null,
      },
      include: {
        client: true,
      },
    })

    // Create job site address if provided
    if (jobSite) {
      await prisma.address.create({
        data: {
          jobId: job.id,
          type: 'job_site',
          street: jobSite.street,
          city: jobSite.city,
          state: jobSite.state,
          zipCode: jobSite.zipCode,
          country: jobSite.country || 'US',
          notes: jobSite.notes || null,
        },
      })
    }

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'JOB_CREATED',
        description: `Job "${title}" created for ${client.name}`,
        jobId: job.id,
        clientId,
      },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'CREATE',
        entityType: 'Job',
        entityId: job.id,
        changes: {
          jobNumber,
          title,
          clientId,
        },
      },
    })

    return NextResponse.json({ job }, { status: 201 })
  } catch (error) {
    console.error('Create job error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
