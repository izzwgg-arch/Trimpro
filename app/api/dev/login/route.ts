import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  createRefreshToken,
} from '@/lib/auth'

const DEV_EMAIL = 'admin@trimpro.com'
const DEV_PASSWORD = 'admin123'

async function ensureDevAdmin() {
  let user = await prisma.user.findFirst({
    where: { email: DEV_EMAIL, status: 'ACTIVE' },
    include: { tenant: true },
  })

  if (user) {
    return user
  }

  let tenant = await prisma.tenant.findFirst({
    where: { name: 'Default Tenant' },
  })

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Default Tenant',
        subdomain: 'default',
        isActive: true,
      },
    })
  }

  const passwordHash = await hashPassword(DEV_PASSWORD)

  user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: DEV_EMAIL,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash,
      lastPasswordChange: new Date(),
    },
    include: { tenant: true },
  })

  return user
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  try {
    const user = await ensureDevAdmin()

    if (!user.passwordHash || !(await verifyPassword(DEV_PASSWORD, user.passwordHash))) {
      return NextResponse.json({ error: 'Dev admin credentials mismatch' }, { status: 500 })
    }

    const payload = {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    }

    const accessToken = generateAccessToken(payload)
    const refreshToken = generateRefreshToken(payload)
    const deviceId = crypto.randomUUID()

    await createRefreshToken(user.id, refreshToken, deviceId)

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    return NextResponse.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenant.name,
      },
    })
  } catch (error: any) {
    console.error('Dev login error:', error)

    if (error.message?.includes("Can't reach database")) {
      return NextResponse.json(
        {
          error: 'Database not available',
          message: 'Start PostgreSQL, then run: npm run dev:setup',
        },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { error: 'Dev login failed', message: error.message },
      { status: 500 }
    )
  }
}
