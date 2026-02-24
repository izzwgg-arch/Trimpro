import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { createNotification } from '@/lib/notifications'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const actor = getAuthUser(request)
  if (String(actor.role) !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(request.url)
  const body = await request.json().catch(() => ({}))
  const userId = String(body?.userId || url.searchParams.get('userId') || actor.id).trim()

  const traceId = `admin_test_${Date.now()}_${actor.id}`
  await createNotification({
    tenantId: actor.tenantId,
    userId,
    type: 'SYSTEM',
    title: 'TrimPro admin test notification',
    message: `Trace ID: ${traceId}`,
    action: 'admin_test',
    dedupeKey: `${actor.tenantId}:${userId}:SYSTEM:admin_test:${Math.floor(Date.now() / 5000)}`,
    actorUserId: actor.id,
  })

  return NextResponse.json({ success: true, traceId, userId })
}
