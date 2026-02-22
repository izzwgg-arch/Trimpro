import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { publishDispatchRealtime } from '@/lib/dispatch-realtime'
import { notifyDispatchJobActivity } from '@/lib/notifications'

/**
 * Mobile API: Update job status
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'jobs.update')
  if (permError) return permError

  const user = getAuthUser(request)
  const jobId = params.id

  try {
    const body = await request.json()
    const { status, notes } = body

    if (!status) {
      return NextResponse.json({ error: 'Status is required' }, { status: 400 })
    }

    // Verify job exists, belongs to tenant, and is assigned to user
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        tenantId: user.tenantId,
        assignments: {
          some: {
            userId: user.id,
          },
        },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found or not assigned to you' }, { status: 404 })
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
    })

    return NextResponse.json({ job: updatedJob })
  } catch (error) {
    console.error('Mobile job status update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
