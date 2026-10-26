import { EventEmitter } from 'events'
import { ChatConversationType, ChatDeliveryStatus, ChatMessageType, type VideoCall } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createOrGetDmConversation } from '@/lib/chat/service'
import { sendPushToUser } from '@/lib/services/mobile-push'
import {
  RING_TIMEOUT_MS,
  buildIceServers,
  callLogText,
  isFinalStatus,
  staleCallStatus,
  type CallRole,
  type CallStatus,
} from './logic'

// One emitter per server process, kept on globalThis so every route bundle shares it.
// It only wakes waiting streams early; the database stays the source of truth.
const g = globalThis as unknown as { __trimproCallBus?: EventEmitter }
function bus() {
  if (!g.__trimproCallBus) {
    g.__trimproCallBus = new EventEmitter()
    g.__trimproCallBus.setMaxListeners(0)
  }
  return g.__trimproCallBus
}

export function notifyCall(callId: string) {
  bus().emit(callId)
}

/** Resolves on the next change to this call, after `ms`, or when the request goes away. */
export function waitForCallEvent(callId: string, ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      bus().off(callId, done)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    bus().on(callId, done)
    signal?.addEventListener('abort', done)
  })
}

type NameRow = { firstName: string | null; lastName: string | null; email: string }
export function personName(u: NameRow | null | undefined) {
  if (!u) return 'Team member'
  const full = `${u.firstName || ''} ${u.lastName || ''}`.trim()
  return full || u.email
}

export function roleIn(call: Pick<VideoCall, 'callerId' | 'calleeId'>, userId: string): CallRole | null {
  if (call.callerId === userId) return 'caller'
  if (call.calleeId === userId) return 'callee'
  return null
}

export async function loadCallForUser(tenantId: string, callId: string, userId: string) {
  const call = await prisma.videoCall.findFirst({ where: { id: callId, tenantId } })
  if (!call || !roleIn(call, userId)) return null
  return closeIfStale(call)
}

export async function serializeCall(call: VideoCall, userId: string) {
  const role = roleIn(call, userId) as CallRole
  const otherId = role === 'caller' ? call.calleeId : call.callerId
  const other = await prisma.user.findFirst({
    where: { id: otherId, tenantId: call.tenantId },
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
  })
  return {
    id: call.id,
    status: call.status,
    video: call.video,
    role,
    conversationId: call.conversationId,
    otherUser: { id: otherId, name: personName(other), avatar: other?.avatar || null },
    createdAt: call.createdAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    ringTimeoutMs: RING_TIMEOUT_MS,
  }
}

export function iceServersFor(userId: string) {
  return buildIceServers(process.env, userId, Date.now())
}

/** Closes a call that rang out or that nobody is on any more; returns the current row. */
export async function closeIfStale(call: VideoCall) {
  const stale = staleCallStatus(call as any, new Date())
  if (!stale) return call
  return (await finishCall(call.id, stale, null)) || call
}

/**
 * Moves an open call to a final status exactly once (a second request is a no-op),
 * writes the call into the two people's chat and wakes both call screens.
 */
export async function finishCall(callId: string, status: CallStatus, byUserId: string | null) {
  if (!isFinalStatus(status)) throw new Error('finishCall needs a final status')
  const now = new Date()
  const res = await prisma.videoCall.updateMany({
    where: { id: callId, status: { in: ['RINGING', 'ACTIVE'] } },
    data: { status, endedAt: now, endedById: byUserId },
  })
  const call = await prisma.videoCall.findUnique({ where: { id: callId } })
  if (!call) return null
  if (res.count === 1) {
    notifyCall(callId)
    await postCallLog(call).catch((error) => console.error('video call log message failed', error))
    if (status === 'MISSED' || status === 'CANCELED') {
      const caller = await prisma.user.findUnique({ where: { id: call.callerId }, select: { firstName: true, lastName: true, email: true } })
      void sendPushToUser(call.calleeId, {
        title: call.video ? 'Missed video call' : 'Missed call',
        body: `${personName(caller)} tried to call you`,
        data: { type: 'video_call_missed', callId: call.id, linkType: 'message', linkId: call.conversationId || '' },
      }).catch(() => null)
    }
  }
  return call
}

async function postCallLog(call: VideoCall) {
  let conversationId = call.conversationId
  if (!conversationId) {
    const dm = await createOrGetDmConversation(call.tenantId, call.callerId, call.calleeId)
    conversationId = dm.id
  }
  const message = await prisma.chatMessage.create({
    data: {
      tenantId: call.tenantId,
      conversationId,
      senderId: call.callerId,
      type: ChatMessageType.TEXT,
      text: callLogText(call as any),
      status: ChatDeliveryStatus.SENT,
    },
  })
  await prisma.chatConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: message.createdAt, updatedAt: new Date() },
  })
}

/** The other person in a direct chat the caller belongs to, or null. */
export async function calleeFromConversation(tenantId: string, conversationId: string, userId: string) {
  const conversation = await prisma.chatConversation.findFirst({
    where: { id: conversationId, tenantId, type: ChatConversationType.DM },
  })
  if (!conversation) return null
  if (conversation.userAId !== userId && conversation.userBId !== userId) return null
  const other = conversation.userAId === userId ? conversation.userBId : conversation.userAId
  return other ? { calleeId: other, conversationId: conversation.id } : null
}

/** Closes leftovers from this user's earlier calls (a closed tab, a dropped phone). */
export async function closeOpenCallsFor(tenantId: string, userId: string) {
  const open = await prisma.videoCall.findMany({
    where: { tenantId, status: { in: ['RINGING', 'ACTIVE'] }, OR: [{ callerId: userId }, { calleeId: userId }] },
  })
  for (const call of open) {
    if (call.status === 'RINGING' && call.calleeId === userId) {
      await closeIfStale(call)
      continue
    }
    await finishCall(call.id, call.status === 'RINGING' ? 'CANCELED' : 'ENDED', userId)
  }
}

/** True when this user is on an answered call that is still live. */
export async function isOnLiveCall(tenantId: string, userId: string) {
  const active = await prisma.videoCall.findMany({
    where: { tenantId, status: 'ACTIVE', OR: [{ callerId: userId }, { calleeId: userId }] },
  })
  for (const call of active) {
    const current = await closeIfStale(call)
    if (current.status === 'ACTIVE') return true
  }
  return false
}

export async function markSeen(call: VideoCall, userId: string) {
  const role = roleIn(call, userId)
  if (!role || isFinalStatus(call.status as CallStatus)) return
  await prisma.videoCall.update({
    where: { id: call.id },
    data: role === 'caller' ? { callerSeenAt: new Date() } : { calleeSeenAt: new Date() },
  })
}

export async function ringCallee(call: VideoCall, callerName: string) {
  await sendPushToUser(call.calleeId, {
    title: call.video ? 'Incoming video call' : 'Incoming call',
    body: `${callerName} is calling you`,
    data: { type: 'video_call', callId: call.id, video: call.video, callerName },
  })
}

/** Signals older than a day belong to finished calls; drop them now and then. */
export async function pruneOldSignals() {
  await prisma.videoCallSignal.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } })
}
