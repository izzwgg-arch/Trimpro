import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const searchParams = request.nextUrl.searchParams
  const view = searchParams.get('view') || 'week' // day, week, month
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const userId = searchParams.get('userId') || 'all'

  try {
    let start: Date
    let end: Date

    if (startDate && endDate) {
      start = new Date(startDate)
      end = new Date(endDate)
    } else {
      const now = new Date()
      switch (view) {
        case 'day':
          start = startOfDay(now)
          end = endOfDay(now)
          break
        case 'week':
          start = startOfWeek(now, { weekStartsOn: 1 })
          end = endOfWeek(now, { weekStartsOn: 1 })
          break
        case 'month':
          start = startOfMonth(now)
          end = endOfMonth(now)
          break
        default:
          start = startOfWeek(now, { weekStartsOn: 1 })
          end = endOfWeek(now, { weekStartsOn: 1 })
      }
    }

    const where: any = {
      tenantId: user.tenantId,
      startTime: {
        lte: end,
      },
      endTime: {
        gte: start,
      },
    }

    if (userId !== 'all') {
      where.userId = userId
    }

    const schedules = await prisma.schedule.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        job: {
          select: {
            id: true,
            jobNumber: true,
            title: true,
            status: true,
            client: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        startTime: 'asc',
      },
    })

    // Check for conflicts
    const conflicts: string[] = []
    for (let i = 0; i < schedules.length; i++) {
      for (let j = i + 1; j < schedules.length; j++) {
        const s1 = schedules[i]
        const s2 = schedules[j]
        if (s1.userId === s2.userId) {
          // Check if time ranges overlap
          if (
            (s1.startTime <= s2.endTime && s1.endTime >= s2.startTime) ||
            (s2.startTime <= s1.endTime && s2.endTime >= s1.startTime)
          ) {
            conflicts.push(`${s1.id},${s2.id}`)
          }
        }
      }
    }

    return NextResponse.json({
      schedules,
      conflicts,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    })
  } catch (error) {
    console.error('Get schedules error:', error)
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
      startTime,
      endTime,
      allDay,
      userId,
      jobId,
      leadId,
    } = body

    if (!title || !startTime || !endTime || !userId) {
      return NextResponse.json({ error: 'Title, start time, end time, and user are required' }, { status: 400 })
    }

    // Verify user belongs to tenant
    const assignedUser = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId: user.tenantId,
      },
    })

    if (!assignedUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check for conflicts
    const conflictingSchedules = await prisma.schedule.findMany({
      where: {
        tenantId: user.tenantId,
        userId,
        startTime: {
          lte: new Date(endTime),
        },
        endTime: {
          gte: new Date(startTime),
        },
      },
    })

    if (conflictingSchedules.length > 0) {
      return NextResponse.json(
        {
          error: 'Schedule conflict detected',
          conflicts: conflictingSchedules.map((s) => ({
            id: s.id,
            title: s.title,
            startTime: s.startTime,
            endTime: s.endTime,
          })),
        },
        { status: 409 }
      )
    }

    // Create schedule
    const schedule = await prisma.schedule.create({
      data: {
        tenantId: user.tenantId,
        title,
        description: description || null,
        type: type || 'OTHER',
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        allDay: allDay || false,
        userId,
        jobId: jobId || null,
        leadId: leadId || null,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        job: {
          select: {
            id: true,
            jobNumber: true,
            title: true,
          },
        },
        lead: true,
      },
    })

    // Update job scheduled dates if linked
    if (jobId) {
      const job = await prisma.job.findFirst({
        where: {
          id: jobId,
          tenantId: user.tenantId,
        },
      })

      if (job) {
        await prisma.job.update({
          where: { id: jobId },
          data: {
            scheduledStart: new Date(startTime),
            scheduledEnd: new Date(endTime),
            status: job.status === 'QUOTE' ? 'SCHEDULED' : job.status,
          },
        })
      }
    }

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'SCHEDULE_CREATED',
        description: `Schedule "${title}" created for ${assignedUser.firstName} ${assignedUser.lastName}`,
        jobId: jobId || undefined,
        leadId: leadId || undefined,
      },
    })

    // Create notification for assigned user
    if (userId !== user.id) {
      await prisma.notification.create({
        data: {
          tenantId: user.tenantId,
          userId,
          type: 'SCHEDULE_REMINDER',
          title: 'New Schedule',
          message: `You have been scheduled: "${title}"`,
          linkType: 'schedule',
          linkId: schedule.id,
          linkUrl: `/dashboard/schedule`,
        },
      })
    }

    return NextResponse.json({ schedule }, { status: 201 })
  } catch (error) {
    console.error('Create schedule error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
