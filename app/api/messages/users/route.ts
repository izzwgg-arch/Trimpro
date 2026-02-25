import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)

  try {
    const { searchParams } = new URL(request.url)
    const query = String(searchParams.get('q') || '').trim()

    const users = await prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        ...(query
          ? {
              OR: [
                { firstName: { contains: query, mode: 'insensitive' } },
                { lastName: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 200,
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('messages users GET error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
