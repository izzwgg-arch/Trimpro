/**
 * Video calls: allowed moves, stale calls, TURN credentials, chat log line.
 * Pure functions — no Prisma, no network.
 * Run with:  npx tsx --test tests/video-calls.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'crypto'
import {
  ACTIVE_STALE_MS,
  RING_TIMEOUT_MS,
  buildIceServers,
  callLogText,
  formatCallDuration,
  planCallAction,
  staleCallStatus,
  turnCredentials,
} from '../lib/video-calls/logic'

test('answering: only the person called, only while ringing; a retry is harmless', () => {
  assert.deepEqual(planCallAction('RINGING', 'answer', 'callee'), { kind: 'update', status: 'ACTIVE' })
  assert.equal(planCallAction('ACTIVE', 'answer', 'callee').kind, 'noop')
  assert.equal(planCallAction('RINGING', 'answer', 'caller').kind, 'error')
  assert.equal(planCallAction('CANCELED', 'answer', 'callee').kind, 'error')
})

test('hanging up gives the right final status for who and when', () => {
  assert.deepEqual(planCallAction('RINGING', 'end', 'caller'), { kind: 'update', status: 'CANCELED' })
  assert.deepEqual(planCallAction('RINGING', 'end', 'callee'), { kind: 'update', status: 'DECLINED' })
  assert.deepEqual(planCallAction('RINGING', 'decline', 'callee'), { kind: 'update', status: 'DECLINED' })
  assert.deepEqual(planCallAction('ACTIVE', 'end', 'caller'), { kind: 'update', status: 'ENDED' })
  assert.deepEqual(planCallAction('ACTIVE', 'end', 'callee'), { kind: 'update', status: 'ENDED' })
  assert.equal(planCallAction('ENDED', 'end', 'caller').kind, 'noop')
  assert.equal(planCallAction('RINGING', 'decline', 'caller').kind, 'error')
})

test('a call rings out, and an answered call nobody is on gets closed', () => {
  const t0 = new Date(Date.UTC(2026, 9, 26, 9, 0, 0))
  const at = (ms: number) => new Date(t0.getTime() + ms)
  const ringing = { status: 'RINGING' as const, createdAt: t0, answeredAt: null, callerSeenAt: null, calleeSeenAt: null }
  assert.equal(staleCallStatus(ringing, at(RING_TIMEOUT_MS - 1000)), null)
  assert.equal(staleCallStatus(ringing, at(RING_TIMEOUT_MS + 1000)), 'MISSED')

  const active = { status: 'ACTIVE' as const, createdAt: t0, answeredAt: at(5000), callerSeenAt: at(600_000), calleeSeenAt: at(590_000) }
  assert.equal(staleCallStatus(active, at(600_000 + ACTIVE_STALE_MS - 1000)), null)
  assert.equal(staleCallStatus(active, at(600_000 + ACTIVE_STALE_MS + 1000)), 'ENDED')
  assert.equal(staleCallStatus({ ...active, status: 'ENDED' }, at(10_000_000)), null)
})

test('TURN credentials match coturn shared-secret format', () => {
  const now = Date.UTC(2026, 9, 26, 9, 0, 0)
  const { username, credential } = turnCredentials('s3cret', 'user_1', now, 3600)
  assert.equal(username, `${Math.floor(now / 1000) + 3600}:user_1`)
  assert.equal(credential, createHmac('sha1', 's3cret').update(username).digest('base64'))
})

test('ICE servers: our own TURN when configured, STUN fallback otherwise', () => {
  const own = buildIceServers({ TURN_HOST: 'turn.example.com', TURN_SECRET: 'x', TURN_TLS_PORT: '5349' }, 'u', Date.now())
  assert.deepEqual(own[0].urls, ['stun:turn.example.com:3478'])
  assert.deepEqual(own[1].urls, [
    'turn:turn.example.com:3478?transport=udp',
    'turn:turn.example.com:3478?transport=tcp',
    'turns:turn.example.com:5349?transport=tcp',
  ])
  assert.ok(own[1].username && own[1].credential)
  assert.equal(JSON.stringify(own).includes('google'), false)

  const dev = buildIceServers({}, 'u', Date.now())
  assert.equal(dev.length, 1)
  assert.equal(dev[0].username, undefined)
})

test('call line written into the chat', () => {
  const answeredAt = new Date(Date.UTC(2026, 9, 26, 9, 0, 0))
  const endedAt = new Date(answeredAt.getTime() + 192_000)
  assert.equal(callLogText({ status: 'ENDED', video: true, answeredAt, endedAt }), '📹 Video call · 3m 12s')
  assert.equal(callLogText({ status: 'ENDED', video: false, answeredAt, endedAt }), '📞 Audio call · 3m 12s')
  assert.equal(callLogText({ status: 'MISSED', video: true, answeredAt: null, endedAt }), '📹 Missed video call')
  assert.equal(callLogText({ status: 'CANCELED', video: false, answeredAt: null, endedAt }), '📞 Missed audio call')
  assert.equal(callLogText({ status: 'DECLINED', video: true, answeredAt: null, endedAt }), '📹 Video call declined')
  assert.equal(formatCallDuration(45), '45s')
  assert.equal(formatCallDuration(3725), '1h 02m')
})
