import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { solaService } from '@/lib/services/sola'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { parseAddressParts } from '@/lib/address/parse'
import { requireRecaptchaV3 } from '@/lib/security/recaptcha'

function resolvePublicAppUrl() {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.PUBLIC_APP_URL,
    process.env.APP_URL,
    'https://app.trimprony.com',
  ]
  const blocked = /(localhost|127\.0\.0\.1|0\.0\.0\.0|154\.12\.235\.86)(:\d+)?/i
  for (const candidate of candidates) {
    const value = String(candidate || '').trim()
    if (!value) continue
    if (blocked.test(value)) continue
    return value.replace(/\/+$/, '')
  }
  return 'https://app.trimprony.com'
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json().catch(() => ({}))
    const token = String(body.token || '')
    const recaptchaToken = body.recaptchaToken
    const payAllOutstanding = Boolean(body.payAllOutstanding)
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 })
    }

    const captcha = await requireRecaptchaV3({
      request,
      token: recaptchaToken,
      expectedAction: 'public_invoice_pay_card',
    })
    if (captcha) return captcha

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: params.id,
        paymentToken: token,
      },
      include: {
        client: {
          include: {
            contacts: {
              where: { isPrimary: true },
              take: 1,
            },
            addresses: {
              orderBy: [{ isDefault: 'desc' }],
            },
          },
        },
        job: {
          include: {
            addresses: {
              where: { type: 'job_site' },
              take: 1,
            },
          },
        },
        estimate: {
          select: {
            jobSiteAddress: true,
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const openWhere = {
      tenantId: invoice.tenantId,
      clientId: invoice.clientId,
      balance: { gt: 0 },
      status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] as any },
    }

    const openAgg = payAllOutstanding
      ? await prisma.invoice.aggregate({
          where: openWhere as any,
          _sum: { balance: true },
          _count: { _all: true },
        })
      : null

    const amountToPay = payAllOutstanding
      ? Number((openAgg as any)?._sum?.balance ?? 0)
      : Number(invoice.balance)

    if (!Number.isFinite(amountToPay) || amountToPay <= 0) {
      return NextResponse.json({ error: 'Invoice already paid' }, { status: 400 })
    }

    const solaSecrets = await getIntegrationSecrets(invoice.tenantId, 'sola')
    if (!solaSecrets?.secretKey) {
      return NextResponse.json({ error: 'Sola integration is not configured (missing secret key).' }, { status: 400 })
    }

    const appUrl = resolvePublicAppUrl()

    const billingAddress = invoice.client.addresses?.find((a) => a.type === 'billing') || invoice.client.addresses?.[0]
    const jobAddress = invoice.job?.addresses?.[0]
    const estimateAddress = parseAddressParts(invoice.estimate?.jobSiteAddress)

    const groupRef = `TPCLIENT:${invoice.clientId}`
    const displayRef = payAllOutstanding ? 'Outstanding Invoices' : `Invoice ${invoice.invoiceNumber}`
    const description = payAllOutstanding
      ? `Outstanding invoices for ${invoice.client.name}`
      : `Invoice ${invoice.invoiceNumber} - ${invoice.title}`

    const paymentLink = await solaService.createPaymentLink({
      // Keep invoiceId in metadata; use invoiceNumber as the payment reference that comes back via hosted forms.
      invoiceId: invoice.id,
      invoiceNumber: payAllOutstanding ? groupRef : invoice.invoiceNumber,
      amount: amountToPay,
      description: description,
      clientEmail: invoice.client.email || invoice.client.contacts?.[0]?.email || undefined,
      clientName: invoice.client.name,
      clientPhone: invoice.client.phone || invoice.client.contacts?.[0]?.phone || undefined,
      billingStreet: billingAddress?.street || jobAddress?.street || estimateAddress?.street || undefined,
      billingCity: billingAddress?.city || jobAddress?.city || estimateAddress?.city || undefined,
      billingState: billingAddress?.state || jobAddress?.state || estimateAddress?.state || undefined,
      billingZip: billingAddress?.zipCode || jobAddress?.zipCode || estimateAddress?.zipCode || undefined,
      billingCountry: billingAddress?.country || jobAddress?.country || 'US',
      returnUrl: `${appUrl}/portal/pay/${invoice.id}?token=${invoice.paymentToken || ''}`,
      webhookUrl: `${appUrl}/api/webhooks/sola-payment`,
      apiKey: solaSecrets.secretKey,
    })

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        solaPaymentUrl: paymentLink.url || null,
        solaTransactionId: paymentLink.id || null,
      },
    })

    return NextResponse.json({
      paymentUrl: paymentLink.url,
      paymentId: paymentLink.id,
      expiresAt: paymentLink.expiresAt,
      mode: payAllOutstanding ? 'all_outstanding' : 'single',
      reference: payAllOutstanding ? groupRef : invoice.invoiceNumber,
      label: displayRef,
    })
  } catch (error: any) {
    console.error('Public payment link error:', error)
    return NextResponse.json({ error: error.message || 'Failed to create payment link' }, { status: 500 })
  }
}

