import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireAnyPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'

// Active people who can be put on a job / task / issue team.
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireAnyPermission(request, [
    'jobs.assign',
    'tasks.create',
    'tasks.edit',
    'issues.create',
    'issues.edit',
  ])
  if (permError) return permError

  const user = getAuthUser(request)
  try {
    const users = await prisma.user.findMany({
      where: { tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 500,
    })
    return NextResponse.json({ users })
  } catch (error) {
    console.error('Get assignable users error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
