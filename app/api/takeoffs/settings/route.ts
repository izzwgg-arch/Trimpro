import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { mergeTakeoffConfig } from '@/lib/takeoffs/config'
import { loadTakeoffConfig, requireTakeoffPermission } from '@/lib/takeoffs/server'

// GET — dropdown options and categories (anyone who can see takeoffs needs them).
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireTakeoffPermission(request, 'view')
  if (permError) return permError

  const user = getAuthUser(request)
  return NextResponse.json({ config: await loadTakeoffConfig(user.tenantId) })
}

// PUT — save the company's dropdown options and categories (Settings).
export async function PUT(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireTakeoffPermission(request, 'settings')
  if (permError) return permError

  const user = getAuthUser(request)
  try {
    const body = await request.json()
    const config = mergeTakeoffConfig(body?.config)
    await prisma.takeoffSettings.upsert({
      where: { tenantId: user.tenantId },
      create: { tenantId: user.tenantId, config: config as any },
      update: { config: config as any },
    })
    return NextResponse.json({ config })
  } catch (err) {
    console.error('Save takeoff settings error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
