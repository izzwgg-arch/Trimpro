import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'

export const runtime = 'nodejs'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const since = searchParams.get('since') // ISO string

  let sinceDate: Date | null = null
  if (since) {
    const d = new Date(since)
    if (!Number.isNaN(d.getTime())) sinceDate = d
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      // Initial hello
      send('hello', { ok: true })

      let cursor = sinceDate || new Date(Date.now() - 60_000)

      while (!request.signal.aborted) {
        try {
          const notifications = await prisma.notification.findMany({
            where: {
              tenantId: user.tenantId,
              userId: user.id,
              createdAt: { gt: cursor },
            },
            orderBy: { createdAt: 'asc' },
            take: 50,
          })

          if (notifications.length > 0) {
            cursor = new Date(notifications[notifications.length - 1]!.createdAt)
            send('notifications', { notifications })
          } else {
            // keep-alive
            send('ping', { t: new Date().toISOString() })
          }
        } catch (e: any) {
          send('error', { error: 'stream_error' })
        }

        // Poll cadence; fast enough to feel real-time without hammering DB
        await sleep(4000)
      }

      controller.close()
    },
    cancel: () => {},
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

