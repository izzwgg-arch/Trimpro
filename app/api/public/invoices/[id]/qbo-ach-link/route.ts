import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { rateLimitOrThrow } from '@/lib/security/rate-limit'
import { createAchPaymentSession } from '@/lib/qbo/payments-ach'
import { requireRecaptchaV3 } from '@/lib/security/recaptcha'

const bodySchema = z.object({
  token: z.string().min(1),
  recaptchaToken: z.string().optional(),
  targetInvoiceId: z.string().optional(),
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
  const targetInvoiceId = String(parsed.data.targetInvoiceId || params.id).trim()
  const captcha = await requireRecaptchaV3({
    request,
    token: parsed.data.recaptchaToken,
    expectedAction: 'public_invoice_pay_ach',
  })
  if (captcha) {
    const errorData = await captcha.json().catch(() => ({}))
    console.error('[QBO ACH] reCAPTCHA verification failed:', errorData)
    return captcha
  }

  // Authorize: the token must belong to *some* invoice; then allow paying any invoice for the same client.
  const authInvoice = await prisma.invoice.findFirst({
    where: { paymentToken: token },
    select: { tenantId: true, clientId: true },
  })
  if (!authInvoice) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: targetInvoiceId,
      tenantId: authInvoice.tenantId,
      clientId: authInvoice.clientId,
    },
    select: {
      id: true,
      tenantId: true,
      balance: true,
    },
  })

  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
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

