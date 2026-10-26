import { createHmac } from 'crypto'
import { formatCallDuration } from './format'

export { formatCallDuration }

/**
 * Video call rules that don't touch the database: which moves are allowed,
 * when a call is stale, TURN credentials and the line written into the chat.
 */

export type CallStatus = 'RINGING' | 'ACTIVE' | 'ENDED' | 'DECLINED' | 'MISSED' | 'CANCELED'
export type CallAction = 'answer' | 'decline' | 'end'
export type CallRole = 'caller' | 'callee'

/** How long a call rings before it counts as missed. */
export const RING_TIMEOUT_MS = 45_000
/** An answered call with no open call screen for this long is closed. */
export const ACTIVE_STALE_MS = 60_000

const FINAL: CallStatus[] = ['ENDED', 'DECLINED', 'MISSED', 'CANCELED']

export function isFinalStatus(status: CallStatus) {
  return FINAL.includes(status)
}

export type CallPlan =
  | { kind: 'update'; status: CallStatus }
  | { kind: 'noop' }
  | { kind: 'error'; error: string; httpStatus: number }

export function planCallAction(status: CallStatus, action: CallAction, role: CallRole): CallPlan {
  if (action === 'answer') {
    if (role !== 'callee') return { kind: 'error', error: 'Only the person being called can answer', httpStatus: 403 }
    if (status === 'RINGING') return { kind: 'update', status: 'ACTIVE' }
    if (status === 'ACTIVE') return { kind: 'noop' }
    return { kind: 'error', error: 'This call has already ended', httpStatus: 409 }
  }

  if (isFinalStatus(status)) return { kind: 'noop' }

  if (action === 'decline') {
    if (role !== 'callee') return { kind: 'error', error: 'Only the person being called can decline', httpStatus: 403 }
    return { kind: 'update', status: status === 'RINGING' ? 'DECLINED' : 'ENDED' }
  }

  // end / hang up
  if (status === 'RINGING') return { kind: 'update', status: role === 'caller' ? 'CANCELED' : 'DECLINED' }
  return { kind: 'update', status: 'ENDED' }
}

type StaleInput = {
  status: CallStatus
  createdAt: Date
  answeredAt: Date | null
  callerSeenAt: Date | null
  calleeSeenAt: Date | null
}

/** The status a call should be closed with because nobody is on it any more, or null if it is fine. */
export function staleCallStatus(call: StaleInput, now: Date): CallStatus | null {
  const nowMs = now.getTime()
  if (call.status === 'RINGING') {
    return nowMs - call.createdAt.getTime() > RING_TIMEOUT_MS ? 'MISSED' : null
  }
  if (call.status === 'ACTIVE') {
    const last = Math.max(
      call.answeredAt?.getTime() ?? 0,
      call.callerSeenAt?.getTime() ?? 0,
      call.calleeSeenAt?.getTime() ?? 0,
      call.createdAt.getTime()
    )
    return nowMs - last > ACTIVE_STALE_MS ? 'ENDED' : null
  }
  return null
}

/** The line posted into the two people's direct chat when a call is over. */
export function callLogText(call: { status: CallStatus; video: boolean; answeredAt: Date | null; endedAt: Date | null }) {
  const icon = call.video ? '📹' : '📞'
  const label = call.video ? 'video call' : 'audio call'
  if (call.status === 'ENDED' && call.answeredAt) {
    const seconds = ((call.endedAt ?? new Date()).getTime() - call.answeredAt.getTime()) / 1000
    return `${icon} ${call.video ? 'Video call' : 'Audio call'} · ${formatCallDuration(seconds)}`
  }
  if (call.status === 'DECLINED') return `${icon} ${call.video ? 'Video call' : 'Audio call'} declined`
  return `${icon} Missed ${label}`
}

/**
 * Short-lived TURN login for coturn's shared-secret mode (use-auth-secret):
 * username is "<expiry unix time>:<user id>", password is HMAC-SHA1 of it, base64.
 */
export function turnCredentials(secret: string, userId: string, nowMs: number, ttlSeconds = 12 * 3600) {
  const expiry = Math.floor(nowMs / 1000) + ttlSeconds
  const username = `${expiry}:${userId}`
  const credential = createHmac('sha1', secret).update(username).digest('base64')
  return { username, credential, expiresAt: new Date(expiry * 1000).toISOString() }
}

export type IceServer = { urls: string | string[]; username?: string; credential?: string }

/**
 * ICE servers for a call. With TURN_HOST + TURN_SECRET set this is only our own coturn
 * (STUN + TURN over UDP/TCP, plus TLS when TURN_TLS_PORT is set). Without them (local dev)
 * it falls back to STUN_URLS or a public STUN server so two machines on one network still connect.
 */
export function buildIceServers(env: Record<string, string | undefined>, userId: string, nowMs: number): IceServer[] {
  const host = (env.TURN_HOST || '').trim()
  const secret = (env.TURN_SECRET || '').trim()
  if (host && secret) {
    const port = (env.TURN_PORT || '3478').trim()
    const tlsPort = (env.TURN_TLS_PORT || '').trim()
    const { username, credential } = turnCredentials(secret, userId, nowMs)
    const turnUrls = [`turn:${host}:${port}?transport=udp`, `turn:${host}:${port}?transport=tcp`]
    if (tlsPort) turnUrls.push(`turns:${host}:${tlsPort}?transport=tcp`)
    return [{ urls: [`stun:${host}:${port}`] }, { urls: turnUrls, username, credential }]
  }
  const stun = (env.STUN_URLS || 'stun:stun.l.google.com:19302')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
  return [{ urls: stun }]
}

// ready: the callee's screen is up (caller then sends a fresh offer); offer/answer/ice: WebRTC negotiation;
// media: this side turned its camera or microphone on/off.
export const SIGNAL_KINDS = ['ready', 'offer', 'answer', 'ice', 'media'] as const
export type SignalKind = (typeof SIGNAL_KINDS)[number]
