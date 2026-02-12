import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { solaService } from '@/lib/services/sola'

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

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.PUBLIC_APP_URL ||
      process.env.APP_URL ||
      'https://app.trimprony.com'

    const paymentLink = await solaService.createPaymentLink({
      invoiceId: invoice.id,
      amount: Number(invoice.balance),
      description: `Invoice ${invoice.invoiceNumber} - ${invoice.title}`,
      clientEmail: invoice.client.email || invoice.client.contacts?.[0]?.email || undefined,
      clientName: invoice.client.name,
      returnUrl: `${appUrl}/portal/pay/${invoice.id}?token=${invoice.paymentToken || ''}`,
      webhookUrl: `${appUrl}/api/webhooks/sola-payment`,
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

