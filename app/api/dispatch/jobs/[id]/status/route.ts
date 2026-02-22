import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireAnyPermission } from '@/lib/authorization'
import { validateRequest, jobStatusSchema } from '@/lib/validation'
import { publishDispatchRealtime } from '@/lib/dispatch-realtime'
import { notifyDispatchJobActivity, createNotificationsForUsers } from '@/lib/notifications'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requireAnyPermission(request, ['dispatch.dispatch', 'dispatch.assign'])
  if (permError) return permError

  const user = getAuthUser(request)
  const jobId = params.id

  // Validate request body
  const validation = await validateRequest(request, jobStatusSchema)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  const { status, notes } = validation.data

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

    // Update job status
    const updateData: any = {
      status,
    }

    if (status === 'IN_PROGRESS' && !job.actualStart) {
      updateData.actualStart = new Date()
    }
    if (status === 'COMPLETED' && !job.actualEnd) {
      updateData.actualEnd = new Date()
    }

    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: updateData,
    })

    // Create dispatch event
    const eventType =
      status === 'IN_PROGRESS' ? 'STARTED' : status === 'COMPLETED' ? 'COMPLETED' : status === 'CANCELLED' ? 'CANCELED' : 'STATUS_CHANGED'

    await prisma.dispatchEvent.create({
      data: {
        tenantId: user.tenantId,
        jobId: jobId,
        eventType,
        actorUserId: user.id,
        payload: {
          oldStatus: job.status,
          newStatus: status,
          notes: notes || null,
        },
      },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'UPDATE',
        entityType: 'Job',
        entityId: jobId,
        changes: {
          oldStatus: job.status,
          newStatus: status,
          notes: notes || null,
        },
      },
    })

    publishDispatchRealtime(user.tenantId, {
      id: `status_${jobId}_${Date.now()}`,
      kind: 'dispatch_event',
      ts: new Date().toISOString(),
      jobId,
      eventType,
      payload: {
        oldStatus: job.status,
        newStatus: status,
        notes: notes || null,
      },
      job: {
        id: job.id,
        jobNumber: job.jobNumber,
        title: job.title,
      },
    })

    await notifyDispatchJobActivity({
      tenantId: user.tenantId,
      jobId: job.id,
      title: `Status updated: ${job.jobNumber}`,
      message: `${job.status} -> ${status}`,
    })

    // Notify assigned users about status change
    const assignments = await prisma.jobAssignment.findMany({
      where: { jobId: job.id },
      select: { userId: true },
    })
    const assignedUserIds = assignments.map((a) => a.userId).filter((id) => id !== user.id)

    if (assignedUserIds.length > 0) {
      await createNotificationsForUsers(user.tenantId, assignedUserIds, {
        type: 'OTHER',
        title: `Job Status Updated`,
        message: `${job.jobNumber || job.title}: ${job.status} → ${status}`,
        linkType: 'job',
        linkId: job.id,
        linkUrl: `/dashboard/jobs/${job.id}`,
      })
    }

    return NextResponse.json({ job: updatedJob })
  } catch (error) {
    console.error('Update job status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
