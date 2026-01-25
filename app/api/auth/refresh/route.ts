import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyRefreshToken, generateAccessToken, deleteRefreshToken, generateRefreshToken, createRefreshToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { refreshToken } = await request.json()

    if (!refreshToken) {
      return NextResponse.json({ error: 'Refresh token required' }, { status: 400 })
    }

    // Verify refresh token
    let payload
    try {
      payload = verifyRefreshToken(refreshToken)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 })
    }

    // Check if token exists in database
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    })

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      await deleteRefreshToken(refreshToken)
      return NextResponse.json({ error: 'Refresh token expired' }, { status: 401 })
    }

    // Check if user is still active
    if (tokenRecord.user.status !== 'ACTIVE') {
      await deleteRefreshToken(refreshToken)
      return NextResponse.json({ error: 'User is not active' }, { status: 401 })
    }

    // Generate new tokens
    const newPayload = {
      userId: payload.userId,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
    }

    const newAccessToken = generateAccessToken(newPayload)
    const newRefreshToken = generateRefreshToken(newPayload)

    // Replace old refresh token with new one
    await deleteRefreshToken(refreshToken)
    await createRefreshToken(payload.userId, newRefreshToken)

    return NextResponse.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    })
  } catch (error) {
    console.error('Refresh token error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
