import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const actor = getAuthUser(request)
  if (String(actor.role) !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(request.url)
  const userId = String(url.searchParams.get('userId') || '').trim()
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  const devices = await prisma.userPushDevice.findMany({
    where: {
      tenantId: actor.tenantId,
      userId,
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      platform: true,
      deviceId: true,
      appVersion: true,
      buildNumber: true,
      locale: true,
      timezone: true,
      disabledAt: true,
      lastSeenAt: true,
      expoPushToken: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({
    devices: devices.map((d) => ({
      ...d,
      expoPushToken:
        d.expoPushToken.length > 14
          ? `${d.expoPushToken.slice(0, 10)}...${d.expoPushToken.slice(-4)}`
          : d.expoPushToken,
    })),
  })
}
