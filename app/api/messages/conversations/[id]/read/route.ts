import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { markConversationRead } from '@/lib/chat/service'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)

  try {
    await markConversationRead(user.tenantId, params.id, user.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('messages read POST error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
