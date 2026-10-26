import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { createOrGetDmConversation } from '@/lib/chat/service'
import {
  calleeFromConversation,
  closeOpenCallsFor,
  iceServersFor,
  isOnLiveCall,
  personName,
  pruneOldSignals,
  ringCallee,
  serializeCall,
} from '@/lib/video-calls/service'

/** Start a call to a team member: { conversationId } of a direct chat, or { calleeId }; video defaults to true. */
export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'messages.view')
  if (permError) return permError
  const user = getAuthUser(request)

  const body = await request.json().catch(() => ({}))
  const video = body?.video !== false

  let calleeId = typeof body?.calleeId === 'string' ? body.calleeId : ''
  let conversationId: string | null = null
  if (typeof body?.conversationId === 'string' && body.conversationId) {
    const found = await calleeFromConversation(user.tenantId, body.conversationId, user.id)
    if (!found) return NextResponse.json({ error: 'Calls can be started from a direct chat only' }, { status: 400 })
    calleeId = found.calleeId
    conversationId = found.conversationId
  }
  if (!calleeId) return NextResponse.json({ error: 'Choose who to call' }, { status: 400 })
  if (calleeId === user.id) return NextResponse.json({ error: 'You cannot call yourself' }, { status: 400 })

  const [caller, callee] = await Promise.all([
    prisma.user.findFirst({ where: { id: user.id, tenantId: user.tenantId }, select: { firstName: true, lastName: true, email: true } }),
    prisma.user.findFirst({ where: { id: calleeId, tenantId: user.tenantId, status: 'ACTIVE' }, select: { firstName: true, lastName: true, email: true } }),
  ])
  if (!callee) return NextResponse.json({ error: 'That person is not an active user' }, { status: 404 })

  if (!conversationId) {
    try {
      conversationId = (await createOrGetDmConversation(user.tenantId, user.id, calleeId)).id
    } catch {
      conversationId = null
    }
  }

  await closeOpenCallsFor(user.tenantId, user.id)
  if (await isOnLiveCall(user.tenantId, calleeId)) {
    return NextResponse.json({ error: `${personName(callee)} is on another call` }, { status: 409 })
  }

  const call = await prisma.videoCall.create({
    data: { tenantId: user.tenantId, callerId: user.id, calleeId, conversationId, video, callerSeenAt: new Date() },
  })
  void ringCallee(call, personName(caller)).catch((error) => console.error('video call push failed', error))
  void pruneOldSignals().catch(() => null)

  return NextResponse.json({ call: await serializeCall(call, user.id), iceServers: iceServersFor(user.id) }, { status: 201 })
}
