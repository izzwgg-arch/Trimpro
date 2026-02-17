import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { getAchStatusByInvoice } from '@/lib/qbo/payments-ach'

const querySchema = z.object({
  invoiceId: z.string().min(1),
})

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const url = new URL(request.url)
  const parsed = querySchema.safeParse({ invoiceId: url.searchParams.get('invoiceId') })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Missing invoiceId' }, { status: 400 })
  }

  // Invoice visibility rules are broader in this app; keep it role-gated for now.
  if (!user || !['ADMIN', 'OFFICE', 'ACCOUNTING', 'SALES'].includes(String(user.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await getAchStatusByInvoice({ tenantId: user.tenantId, invoiceId: parsed.data.invoiceId })
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to fetch status' }, { status: 400 })
  }
}

