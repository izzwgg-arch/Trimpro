import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { validateRequest, jobStatusSchema } from '@/lib/validation'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'dispatch.update')
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
        },
      },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'JOB_STATUS_CHANGED',
        entityType: 'Job',
        entityId: jobId,
        metadata: {
          oldStatus: job.status,
          newStatus: status,
          notes: notes || null,
        },
      },
    })

    return NextResponse.json({ job: updatedJob })
  } catch (error) {
    console.error('Update job status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
