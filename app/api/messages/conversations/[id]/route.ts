import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { getConversationForMember, listMessages } from '@/lib/chat/service'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)

  try {
    const conversation = await getConversationForMember(user.tenantId, params.id, user.id)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const cursor = searchParams.get('cursor')
    const limitParam = Number(searchParams.get('limit') || 40)
    const messages = await listMessages(user.tenantId, params.id, user.id, cursor, limitParam)

    return NextResponse.json({
      conversation,
      messages,
    })
  } catch (error) {
    console.error('messages conversation detail GET error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
