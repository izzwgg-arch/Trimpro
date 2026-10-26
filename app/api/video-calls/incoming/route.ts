import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { closeIfStale, serializeCall } from '@/lib/video-calls/service'

/** Calls ringing for the signed-in user right now (polled by the web dashboard and the app). */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'messages.view')
  if (permError) return permError
  const user = getAuthUser(request)

  const ringing = await prisma.videoCall.findMany({
    where: { tenantId: user.tenantId, calleeId: user.id, status: 'RINGING' },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
  const calls = []
  for (const row of ringing) {
    const call = await closeIfStale(row)
    if (call.status === 'RINGING') calls.push(await serializeCall(call, user.id))
  }
  return NextResponse.json({ calls })
}
