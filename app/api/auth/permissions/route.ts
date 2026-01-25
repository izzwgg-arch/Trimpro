import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { getUserPermissions } from '@/lib/authorization'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const permissions = await getUserPermissions(user.id, user.tenantId)

    return NextResponse.json({ permissions })
  } catch (error) {
    console.error('Get permissions error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
