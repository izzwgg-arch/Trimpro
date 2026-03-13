import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { MOCK_RECENT_SESSIONS } from '@/lib/smart-steps/mock-data'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')

  let sessions = MOCK_RECENT_SESSIONS
  if (clientId) sessions = sessions.filter((s) => s.clientId === clientId)

  return NextResponse.json({ sessions, total: sessions.length })
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const body = await request.json()

  const session = {
    id: `sess_${Date.now()}`,
    therapistId: user.id,
    therapistName: user.name || user.email,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    syncStatus: 'synced',
    ...body,
  }

  return NextResponse.json({ session }, { status: 201 })
}
