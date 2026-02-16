import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { solaService } from '@/lib/services/sola'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { parseAddressParts } from '@/lib/address/parse'

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
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 })
    }

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

    if (Number(invoice.balance) <= 0) {
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

    const paymentLink = await solaService.createPaymentLink({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: Number(invoice.balance),
      description: `Invoice ${invoice.invoiceNumber} - ${invoice.title}`,
      clientEmail: invoice.client.email || invoice.client.contacts?.[0]?.email || undefined,
      clientName: invoice.client.name,
      clientPhone: invoice.client.phone || invoice.client.contacts?.[0]?.phone || undefined,
      billingStreet: billingAddress?.street || jobAddress?.street || estimateAddress.street || undefined,
      billingCity: billingAddress?.city || jobAddress?.city || estimateAddress.city || undefined,
      billingState: billingAddress?.state || jobAddress?.state || estimateAddress.state || undefined,
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
    })
  } catch (error: any) {
    console.error('Public payment link error:', error)
    return NextResponse.json({ error: error.message || 'Failed to create payment link' }, { status: 500 })
  }
}

