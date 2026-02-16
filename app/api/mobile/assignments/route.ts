import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'

/**
 * Mobile API: Lightweight assignments feed for technician dashboard refresh.
 * Includes jobs, tasks, and issues assigned to the authenticated technician.
 */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const [jobs, tasks, issues] = await Promise.all([
      prisma.job.findMany({
        where: {
          tenantId: user.tenantId,
          assignments: {
            some: {
              userId: user.id,
            },
          },
        },
        select: {
          id: true,
          jobNumber: true,
          title: true,
          status: true,
          priority: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      prisma.task.findMany({
        where: {
          tenantId: user.tenantId,
          assigneeId: user.id,
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 50,
      }),
      prisma.issue.findMany({
        where: {
          tenantId: user.tenantId,
          assigneeId: user.id,
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          type: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 50,
      }),
    ])

    return NextResponse.json({
      jobs,
      tasks,
      issues,
      serverTime: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Mobile assignments feed error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

