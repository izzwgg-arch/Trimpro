import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { sendEntityReferenceDm } from '@/lib/chat/service'
import { requestDisplayName } from '@/lib/requests/display'

// Send a direct message to one or more teammates that references this request
// (lead), so the recipient always sees which request the message is about.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'messages.view')
  if (permError) return permError
  const user = getAuthUser(request)

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const recipientIds = Array.isArray(body?.recipientIds)
    ? body.recipientIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    : []
  const text = typeof body?.text === 'string' ? body.text : ''

  if (recipientIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one recipient' }, { status: 400 })
  }

  const lead = await prisma.lead.findFirst({
    where: { id: params.id, tenantId: user.tenantId },
    select: { id: true, firstName: true, lastName: true, company: true, jobSiteAddress: true },
  })
  if (!lead) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  const label = requestDisplayName(lead)
  const referenceLine = `📨 Regarding request: “${label}”\n/dashboard/requests/${lead.id}`

  try {
    const sent = await sendEntityReferenceDm(user, recipientIds, referenceLine, text)
    return NextResponse.json({ sent: sent.length, recipients: sent })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Could not send message' },
      { status: 400 }
    )
  }
}
