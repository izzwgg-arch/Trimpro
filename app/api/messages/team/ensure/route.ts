import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { ensureTeamConversationMembers } from '@/lib/chat/service'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  try {
    const conversation = await ensureTeamConversationMembers(user.tenantId)
    return NextResponse.json({ conversationId: conversation.id, conversation })
  } catch (error) {
    console.error('messages team ensure POST error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
