import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'dispatch.view')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    // Get users with tech-related roles or all active users
    const techs = await prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        role: {
          in: ['TECH', 'MANAGER', 'ADMIN'],
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
      },
      orderBy: {
        firstName: 'asc',
      },
    })

    // Check availability for each tech
    const techsWithAvailability = await Promise.all(
      techs.map(async (tech) => {
        const today = new Date()
        const dayOfWeek = today.getDay()

        const availability = await prisma.techAvailability.findFirst({
          where: {
            tenantId: user.tenantId,
            userId: tech.id,
            dayOfWeek,
            isAvailable: true,
          },
        })

        return {
          id: tech.id,
          firstName: tech.firstName,
          lastName: tech.lastName,
          email: tech.email,
          isAvailable: availability !== null,
        }
      })
    )

    return NextResponse.json({ techs: techsWithAvailability })
  } catch (error) {
    console.error('Dispatch techs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
