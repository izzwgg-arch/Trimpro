import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { ensureJobThread } from '@/lib/chat/service'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'messages.send')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const body = await request.json().catch(() => ({}))
    const jobId = typeof body?.jobId === 'string' ? body.jobId : ''
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    const conversation = await ensureJobThread(user.tenantId, jobId, user.id)
    return NextResponse.json({ conversationId: conversation.id, conversation })
  } catch (error: any) {
    const message = String(error?.message || 'Internal server error')
    if (message.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    console.error('messages job ensure POST error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
