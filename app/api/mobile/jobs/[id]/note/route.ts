import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'

/**
 * Mobile API: Add note to job
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
    const { content } = body

    if (!content || content.trim().length === 0) {
      return NextResponse.json({ error: 'Note content is required' }, { status: 400 })
    }

    // Verify job exists and is assigned to user
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

    // Create note
    const note = await prisma.note.create({
      data: {
        tenantId: user.tenantId,
        entityType: 'Job',
        entityId: jobId,
        content: content.trim(),
        createdBy: user.id,
      },
    })

    // Create dispatch event
    await prisma.dispatchEvent.create({
      data: {
        tenantId: user.tenantId,
        jobId: jobId,
        eventType: 'NOTE_ADDED',
        actorUserId: user.id,
        payload: {
          noteId: note.id,
          content: content.trim(),
          source: 'mobile',
        },
      },
    })

    return NextResponse.json({ note }, { status: 201 })
  } catch (error) {
    console.error('Mobile job note error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
