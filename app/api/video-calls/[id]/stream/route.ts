import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { isFinalStatus, type CallStatus } from '@/lib/video-calls/logic'
import { closeIfStale, loadCallForUser, markSeen, serializeCall, waitForCallEvent } from '@/lib/video-calls/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SEEN_EVERY_MS = 10_000
const PING_EVERY_MS = 15_000

/**
 * Server-sent events for one call: `state` whenever the call changes and `signal` for each
 * offer/answer/ICE candidate addressed to this user after `?after=<signal id>`.
 * Read with fetch (Authorization header), so no token goes in the URL.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'messages.view')
  if (permError) return permError
  const user = getAuthUser(request)

  const first = await loadCallForUser(user.tenantId, params.id, user.id)
  if (!first) return NextResponse.json({ error: 'Call not found' }, { status: 404 })

  let after = Number(new URL(request.url).searchParams.get('after') || 0)
  if (!Number.isFinite(after) || after < 0) after = 0

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      let closed = false
      const write = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }
      const send = (event: string, payload: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)

      let lastState = ''
      let lastSeen = 0
      let lastPing = Date.now()
      try {
        while (!request.signal.aborted && !closed) {
          const row = await prisma.videoCall.findUnique({ where: { id: params.id } })
          if (!row) break
          const call = await closeIfStale(row)

          if (Date.now() - lastSeen > SEEN_EVERY_MS) {
            lastSeen = Date.now()
            await markSeen(call, user.id).catch(() => null)
          }

          const stateKey = `${call.status}|${call.answeredAt?.toISOString() || ''}`
          if (stateKey !== lastState) {
            lastState = stateKey
            send('state', await serializeCall(call, user.id))
          }

          const signals = await prisma.videoCallSignal.findMany({
            where: { callId: call.id, toUserId: user.id, id: { gt: after } },
            orderBy: { id: 'asc' },
            take: 200,
          })
          for (const s of signals) {
            send('signal', { id: s.id, kind: s.kind, payload: s.payload })
            after = s.id
          }

          if (isFinalStatus(call.status as CallStatus)) break

          if (Date.now() - lastPing > PING_EVERY_MS) {
            lastPing = Date.now()
            write(': ping\n\n')
          }
          if (signals.length < 200) await waitForCallEvent(call.id, 1000, request.signal)
        }
      } catch (error) {
        console.error('video call stream error', error)
        send('error', { error: 'stream_failed' })
      }
      closed = true
      try {
        controller.close()
      } catch {}
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
