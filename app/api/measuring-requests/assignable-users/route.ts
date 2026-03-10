import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getUserMobilePermissions } from '@/lib/authorization'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)

  const search = String(request.nextUrl.searchParams.get('search') || '').trim().toLowerCase()

  const candidates = await prisma.user.findMany({
    where: {
      tenantId: user.tenantId,
      status: 'ACTIVE',
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
    },
    take: 250,
  })

  const withMobileAccess = await Promise.all(
    candidates.map(async (row) => {
      const perms = await getUserMobilePermissions(row.id, user.tenantId)
      return {
        ...row,
        hasMobileAccess: perms.includes('mobile.access'),
      }
    })
  )

  return NextResponse.json({
    users: withMobileAccess.filter((row) => row.hasMobileAccess),
  })
}
