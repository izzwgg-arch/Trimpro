import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { validateRequest, jobAssignmentSchema } from '@/lib/validation'
import { notifyJobAssigned } from '@/lib/notifications'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'dispatch.assign')
  if (permError) return permError

  const user = getAuthUser(request)

  // Validate request body
  const validation = await validateRequest(request, jobAssignmentSchema)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  const { jobId, userId, scheduledStart, scheduledEnd, notes } = validation.data

  try {

    // Verify job exists and belongs to tenant
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        tenantId: user.tenantId,
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // If userId provided, verify user exists and is in same tenant
    if (userId) {
      const assignedUser = await prisma.user.findFirst({
        where: {
          id: userId,
          tenantId: user.tenantId,
          status: 'ACTIVE',
        },
      })

      if (!assignedUser) {
        return NextResponse.json({ error: 'User not found or inactive' }, { status: 404 })
      }
    }

    // Update job assignment
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        assignedToId: userId || null,
        scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
      },
    })

    // Create dispatch event for audit
    await prisma.dispatchEvent.create({
      data: {
        tenantId: user.tenantId,
        jobId: jobId,
        eventType: userId ? 'ASSIGNED' : 'UNASSIGNED',
        actorUserId: user.id,
        payload: {
          assignedTo: userId || null,
          scheduledStart: scheduledStart || null,
          scheduledEnd: scheduledEnd || null,
          notes: notes || null,
        },
      },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'UPDATE', // Use standard audit action
        entityType: 'Job',
        entityId: jobId,
        changes: {
          assignedTo: userId || null,
          scheduledStart: scheduledStart || null,
          scheduledEnd: scheduledEnd || null,
        },
      },
    })

    // Notify tech if job was assigned
    if (userId && job.title) {
      await notifyJobAssigned(user.tenantId, userId, jobId, job.title)
    }

    return NextResponse.json({ job: updatedJob })
  } catch (error) {
    console.error('Dispatch assign error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
