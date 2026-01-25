import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'

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
        assignedToId: user.id,
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

    return NextResponse.json({ job: updatedJob })
  } catch (error) {
    console.error('Mobile job status update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
