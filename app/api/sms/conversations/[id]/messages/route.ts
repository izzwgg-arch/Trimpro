import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { messagingService } from '@/lib/messaging/service'
import { MessagingChannel } from '@/lib/messaging/types'

export const dynamic = 'force-dynamic'

/** GET /api/sms/conversations/[id]/messages — fetch messages for an SMS conversation. */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: user.tenantId },
  })
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await prisma.message.findMany({
    where: { conversationId: params.id, tenantId: user.tenantId },
    include: { media: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  // Mark conversation as read
  if (conversation.unreadCount > 0) {
    await prisma.conversation.update({
      where: { id: params.id },
      data: { unreadCount: 0 },
    }).catch(() => {})
  }

  return NextResponse.json({ messages, conversation })
}

/** POST /api/sms/conversations/[id]/messages — send an SMS in this conversation. */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: user.tenantId },
  })
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json()
  const text: string = String(body.text || '').trim()
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })

  const participants = Array.isArray(conversation.participants)
    ? (conversation.participants as string[])
    : []
  const toNumber = participants[0]
  if (!toNumber) return NextResponse.json({ error: 'No recipient phone number on this conversation' }, { status: 400 })

  const result = await messagingService.sendMessage(
    user.tenantId,
    { to: toNumber, body: text, channel: MessagingChannel.SMS },
    params.id
  )

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true, messageId: result.messageId })
}
