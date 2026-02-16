import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

type MobilePushTokenRecord = {
  token: string
  platform?: string
  updatedAt: string
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const token = String(body?.token || '').trim()
    const platform = String(body?.platform || '').trim()

    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 })
    }

    const existingUser = await prisma.user.findFirst({
      where: { id: user.id, tenantId: user.tenantId },
      select: { permissions: true },
    })

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const currentPermissions =
      typeof existingUser.permissions === 'object' && existingUser.permissions
        ? (existingUser.permissions as Record<string, any>)
        : {}

    const currentTokens: MobilePushTokenRecord[] = Array.isArray(currentPermissions.mobilePushTokens)
      ? currentPermissions.mobilePushTokens
      : []

    const filtered = currentTokens.filter((item) => item?.token && item.token !== token)
    const updated: MobilePushTokenRecord[] = [
      { token, platform: platform || undefined, updatedAt: new Date().toISOString() },
      ...filtered,
    ].slice(0, 10)

    const permissions = {
      ...currentPermissions,
      mobilePushTokens: updated,
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { permissions },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Mobile push token registration error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

