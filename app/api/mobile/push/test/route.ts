import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { createNotification } from '@/lib/notifications'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)

  if (String(user.role) !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const traceId = `test_${Date.now()}_${user.id}`
  await createNotification({
    tenantId: user.tenantId,
    userId: user.id,
    type: 'SYSTEM',
    title: 'TrimPro test push',
    message: 'This is a test push notification from TrimPro.',
    action: 'test_push',
    dedupeKey: `${user.tenantId}:${user.id}:SYSTEM:test_push:${Math.floor(Date.now() / 10000)}`,
    actorUserId: user.id,
  })

  return NextResponse.json({ success: true, traceId })
}
