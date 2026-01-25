import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const schedule = await prisma.schedule.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        job: {
          include: {
            client: {
              select: {
                id: true,
                name: true,
                companyName: true,
              },
            },
          },
        },
        lead: true,
      },
    })

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    return NextResponse.json({ schedule })
  } catch (error) {
    console.error('Get schedule error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    // Get existing schedule
    const existing = await prisma.schedule.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    // Check for conflicts if time or user changed
    if ((startTime || endTime || userId) && (userId || existing.userId)) {
      const checkUserId = userId || existing.userId
      const checkStartTime = startTime ? new Date(startTime) : existing.startTime
      const checkEndTime = endTime ? new Date(endTime) : existing.endTime

      const conflictingSchedules = await prisma.schedule.findMany({
        where: {
          tenantId: user.tenantId,
          userId: checkUserId,
          id: {
            not: params.id,
          },
          startTime: {
            lte: checkEndTime,
          },
          endTime: {
            gte: checkStartTime,
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
    }

    // Update schedule
    const schedule = await prisma.schedule.update({
      where: { id: params.id },
      data: {
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
        type: type !== undefined ? type : existing.type,
        startTime: startTime !== undefined ? new Date(startTime) : existing.startTime,
        endTime: endTime !== undefined ? new Date(endTime) : existing.endTime,
        allDay: allDay !== undefined ? allDay : existing.allDay,
        userId: userId !== undefined ? userId : existing.userId,
        jobId: jobId !== undefined ? (jobId || null) : existing.jobId,
        leadId: leadId !== undefined ? (leadId || null) : existing.leadId,
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
    if (jobId && (startTime || endTime)) {
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
            scheduledStart: startTime ? new Date(startTime) : job.scheduledStart,
            scheduledEnd: endTime ? new Date(endTime) : job.scheduledEnd,
          },
        })
      }
    }

    return NextResponse.json({ schedule })
  } catch (error) {
    console.error('Update schedule error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const schedule = await prisma.schedule.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    await prisma.schedule.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ message: 'Schedule deleted successfully' })
  } catch (error) {
    console.error('Delete schedule error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
