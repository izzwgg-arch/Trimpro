import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { SIGNAL_KINDS, isFinalStatus, type CallStatus } from '@/lib/video-calls/logic'
import { loadCallForUser, notifyCall, roleIn } from '@/lib/video-calls/service'

const MAX_PAYLOAD_CHARS = 64_000

/** Pass an offer, answer or ICE candidate to the other side: { kind, payload }. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'messages.view')
  if (permError) return permError
  const user = getAuthUser(request)

  const body = await request.json().catch(() => ({}))
  const kind = body?.kind
  if (!SIGNAL_KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown signal' }, { status: 400 })
  if (body?.payload == null || JSON.stringify(body.payload).length > MAX_PAYLOAD_CHARS) {
    return NextResponse.json({ error: 'Bad signal payload' }, { status: 400 })
  }

  const call = await loadCallForUser(user.tenantId, params.id, user.id)
  if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  if (isFinalStatus(call.status as CallStatus)) return NextResponse.json({ error: 'This call has ended' }, { status: 409 })
  if (call.status !== 'ACTIVE' && kind !== 'ice') {
    return NextResponse.json({ error: 'The call has not been answered yet' }, { status: 409 })
  }

  const toUserId = roleIn(call, user.id) === 'caller' ? call.calleeId : call.callerId
  const signal = await prisma.videoCallSignal.create({
    data: { callId: call.id, fromUserId: user.id, toUserId, kind, payload: body.payload },
    select: { id: true },
  })
  notifyCall(call.id)
  return NextResponse.json({ ok: true, id: signal.id })
}
