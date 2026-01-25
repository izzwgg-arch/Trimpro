import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const channel = searchParams.get('channel')
  const assigned = searchParams.get('assigned') === 'me'
  const search = searchParams.get('search')

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (status) {
      where.status = status
    }

    if (channel) {
      where.channel = channel
    }

    if (assigned) {
      where.assignedUserId = user.id
    }

    if (search) {
      // Search in participants or client name
      where.OR = [
        {
          client: {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          client: {
            phone: {
              contains: search,
            },
          },
        },
        {
          client: {
            email: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
      ]
    }

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
          },
        },
        assignedUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            body: true,
            direction: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        lastMessageAt: 'desc',
      },
      take: 100,
    })

    return NextResponse.json({ conversations })
  } catch (error) {
    console.error('Get conversations error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const { channel, to, clientId, jobId, assignedUserId } = body

    // Find client if phone/email matches
    let client = clientId
      ? await prisma.client.findUnique({ where: { id: clientId } })
      : await prisma.client.findFirst({
          where: {
            tenantId: user.tenantId,
            OR: [{ phone: to }, { email: to }],
          },
        })

    // Normalize phone number for matching - merge conversations with same number in different formats
    function normalizeNanpDigits(input: string): string {
      const digits = input.replace(/\D/g, '')
      return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
    }
    
    const normalizedTo = normalizeNanpDigits(to)
    
    // Check if conversation already exists
    // For JSON array fields, we need to check if the array contains the value
    const allConversations = await prisma.conversation.findMany({
      where: {
        tenantId: user.tenantId,
        channel: channel,
      },
      select: {
        id: true,
        participants: true,
      },
    })

    let conversation = allConversations.find((conv) => {
      const participants = conv.participants as any
      if (!Array.isArray(participants)) return false
      // Check if any participant matches after normalization
      return participants.some((participant: string) => {
        const normalizedParticipant = normalizeNanpDigits(participant)
        return normalizedParticipant === normalizedTo
      })
    })

    if (conversation) {
      conversation = await prisma.conversation.findUnique({
        where: { id: conversation.id },
        include: { client: true },
      })
    }

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId: user.tenantId,
          channel: channel,
          clientId: client?.id || null,
          assignedUserId: assignedUserId || user.id,
          jobId: jobId || null,
          participants: [to],
          status: 'ACTIVE',
        },
        include: {
          client: true,
        },
      })
    }

    return NextResponse.json({ conversation })
  } catch (error) {
    console.error('Create conversation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
