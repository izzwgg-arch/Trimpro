import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    // Show active users and invited users so admins can track invite progress.
    const teamMembers = await prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        status: {
          in: ['ACTIVE', 'INVITED'],
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        managerId: true,
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
        status: true,
        _count: {
          select: {
            schedules: true,
          },
        },
      },
      orderBy: [
        { firstName: 'asc' },
        { lastName: 'asc' },
      ],
    })

    const normalizedTeamMembers = teamMembers.map((member) => {
      if (member.role !== 'FIELD') {
        return {
          ...member,
          managerId: null,
          manager: null,
        }
      }
      if (!member.manager || member.manager.role !== 'MANAGER') {
        return {
          ...member,
          managerId: null,
          manager: null,
        }
      }
      return member
    })

    return NextResponse.json({ teamMembers: normalizedTeamMembers })
  } catch (error) {
    console.error('Get team error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
