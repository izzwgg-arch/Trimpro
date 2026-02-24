import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireMobilePermission, hasMobilePermission } from '@/lib/authorization'
import { publishDispatchRealtime } from '@/lib/dispatch-realtime'
import { notifyDispatchJobActivity, createNotificationsForUsers } from '@/lib/notifications'

/**
 * Mobile API: Update job status
 * Requires mobile.jobs.complete permission and job must be assigned to user OR user must have mobile.jobs.view_all+assign
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  // Require mobile.jobs.complete permission
  const permError = await requireMobilePermission(request, 'mobile.jobs.complete')
  if (permError) return permError

  const user = getAuthUser(request)
  const jobId = params.id

  try {
    const body = await request.json()
    const { status, notes } = body

    if (!status) {
      return NextResponse.json({ error: 'Status is required' }, { status: 400 })
    }

    // Check if user can view all jobs (admin/dispatch)
    const canViewAll = await hasMobilePermission(user.id, user.tenantId, 'mobile.jobs.view_all')
    const canAssign = await hasMobilePermission(user.id, user.tenantId, 'mobile.jobs.assign')

    // Verify job exists and belongs to tenant
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        tenantId: user.tenantId,
      },
      include: {
        assignments: {
          select: { userId: true },
        },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Check access: user must be assigned OR have view_all+assign (admin)
    const isAssigned = job.assignments.some((a) => a.userId === user.id)
    const isAdmin = canViewAll && canAssign

    if (!isAssigned && !isAdmin) {
      return NextResponse.json(
        { error: 'Job not assigned to you and you do not have admin access' },
        { status: 403 }
      )
    }

    // Special check for completing job
    if (status === 'COMPLETED') {
      // Additional verification that user has complete permission
      // (already checked above, but double-check for clarity)
    }

    // Update status
    const updateData: any = { status }
    if (status === 'COMPLETED' && !job.actualEnd) {
      updateData.actualEnd = new Date()
    }

    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: updateData,
    })

    // Create dispatch event
    await prisma.dispatchEvent.create({
      data: {
        tenantId: user.tenantId,
        jobId: jobId,
        eventType: 'STATUS_CHANGED',
        actorUserId: user.id,
        payload: {
          oldStatus: job.status,
          newStatus: status,
          notes: notes || null,
          source: 'mobile',
        },
      },
    })

    publishDispatchRealtime(user.tenantId, {
      id: `mobile_status_${jobId}_${Date.now()}`,
      kind: 'dispatch_event',
      ts: new Date().toISOString(),
      jobId,
      eventType: 'STATUS_CHANGED',
      payload: {
        oldStatus: job.status,
        newStatus: status,
        notes: notes || null,
        source: 'mobile',
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
      actorUserId: user.id,
      action: 'status_changed',
    })

    // Notify other assigned users about status change
    const assignments = await prisma.jobAssignment.findMany({
      where: { jobId: job.id },
      select: { userId: true },
    })
    const assignedUserIds = assignments.map((a) => a.userId).filter((id) => id !== user.id)

    if (assignedUserIds.length > 0) {
      await createNotificationsForUsers(user.tenantId, assignedUserIds, {
        type: 'JOB_UPDATED',
        title: `Job Status Updated`,
        message: `${job.jobNumber || job.title}: ${job.status} → ${status}`,
        linkType: 'job',
        linkId: job.id,
        linkUrl: `/dashboard/jobs/${job.id}`,
        actorUserId: user.id,
        action: 'status_changed',
      })
    }

    return NextResponse.json({ job: updatedJob })
  } catch (error) {
    console.error('Mobile job status update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
