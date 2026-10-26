import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { planCallAction, type CallAction, type CallStatus } from '@/lib/video-calls/logic'
import { finishCall, iceServersFor, loadCallForUser, notifyCall, roleIn, serializeCall } from '@/lib/video-calls/service'

async function guard(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return { error: authError }
  const permError = await requirePermission(request, 'messages.view')
  if (permError) return { error: permError }
  return { user: getAuthUser(request) }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (g.error) return g.error
  const call = await loadCallForUser(g.user.tenantId, params.id, g.user.id)
  if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  // A reopened call screen starts reading after this, so it doesn't replay an old negotiation.
  const last = await prisma.videoCallSignal.findFirst({
    where: { callId: call.id, toUserId: g.user.id },
    orderBy: { id: 'desc' },
    select: { id: true },
  })
  return NextResponse.json({
    call: await serializeCall(call, g.user.id),
    iceServers: iceServersFor(g.user.id),
    lastSignalId: last?.id ?? 0,
  })
}

/** { action: 'answer' | 'decline' | 'end' } — repeating an action is harmless. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (g.error) return g.error
  const body = await request.json().catch(() => ({}))
  const action = body?.action as CallAction
  if (!['answer', 'decline', 'end'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const call = await loadCallForUser(g.user.tenantId, params.id, g.user.id)
  if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404 })

  const plan = planCallAction(call.status as CallStatus, action, roleIn(call, g.user.id)!)
  if (plan.kind === 'error') return NextResponse.json({ error: plan.error }, { status: plan.httpStatus })

  let current = call
  if (plan.kind === 'update') {
    if (plan.status === 'ACTIVE') {
      const res = await prisma.videoCall.updateMany({
        where: { id: call.id, status: 'RINGING' },
        data: { status: 'ACTIVE', answeredAt: new Date(), calleeSeenAt: new Date() },
      })
      if (res.count === 1) notifyCall(call.id)
      current = (await prisma.videoCall.findUnique({ where: { id: call.id } })) || call
      if (current.status !== 'ACTIVE') {
        return NextResponse.json({ error: 'This call has already ended' }, { status: 409 })
      }
    } else {
      current = (await finishCall(call.id, plan.status, g.user.id)) || call
    }
  }

  return NextResponse.json({ call: await serializeCall(current, g.user.id), iceServers: iceServersFor(g.user.id) })
}
