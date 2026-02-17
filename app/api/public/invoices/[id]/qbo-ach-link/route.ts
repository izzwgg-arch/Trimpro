import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { rateLimitOrThrow } from '@/lib/security/rate-limit'
import { createAchPaymentSession } from '@/lib/qbo/payments-ach'

const bodySchema = z.object({
  token: z.string().min(1),
})

/**
 * Public endpoint: create/return a QuickBooks ACH hosted payment URL for a tokenized invoice.
 * - Validates `invoice.paymentToken` (unguessable token in email link)
 * - Does NOT expose any secrets
 * - Redirect flow is hosted by QuickBooks (we do not handle bank details)
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    rateLimitOrThrow(request, { key: 'public-qbo-ach-link', limit: 40, windowMs: 60_000 })
  } catch (res: any) {
    return res
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const token = String(parsed.data.token || '').trim()
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: params.id,
      paymentToken: token,
    },
    select: {
      id: true,
      tenantId: true,
      balance: true,
      qboAchEnabled: true,
    },
  })

  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (!invoice.qboAchEnabled) {
    return NextResponse.json({ error: 'ACH is not enabled for this invoice.' }, { status: 400 })
  }
  if (Number(invoice.balance) <= 0) {
    return NextResponse.json({ error: 'Invoice already paid' }, { status: 400 })
  }

  try {
    const result = await createAchPaymentSession({
      tenantId: invoice.tenantId,
      invoiceId: invoice.id,
      createdById: null,
    })

    return NextResponse.json({
      hostedUrl: result.hostedUrl,
      publicUrl: result.publicUrl,
      intentId: result.intentId,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unable to create ACH link' }, { status: 400 })
  }
}

