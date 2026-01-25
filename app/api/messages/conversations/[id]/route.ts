import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: params.id },
      include: {
        client: true,
        assignedUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        messages: {
          include: {
            media: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    })

    if (!conversation || conversation.tenantId !== user.tenantId) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Mark conversation as read for this user
    await prisma.conversationReadReceipt.upsert({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: user.id,
        },
      },
      create: {
        conversationId: conversation.id,
        userId: user.id,
        readAt: new Date(),
      },
      update: {
        readAt: new Date(),
      },
    })

    // Update unread count
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: 0,
      },
    })

    return NextResponse.json({ conversation })
  } catch (error) {
    console.error('Get conversation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
