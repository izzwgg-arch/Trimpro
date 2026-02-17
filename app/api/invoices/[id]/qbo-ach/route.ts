import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireSameOrigin } from '@/lib/security/csrf'

const bodySchema = z.object({
  enabled: z.boolean(),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const csrf = requireSameOrigin(request)
  if (csrf) return csrf

  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  if (!user || !['ADMIN', 'OFFICE', 'ACCOUNTING'].includes(String(user.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, tenantId: user.tenantId },
    select: { id: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { qboAchEnabled: parsed.data.enabled },
  })

  return NextResponse.json({ ok: true, enabled: parsed.data.enabled })
}

