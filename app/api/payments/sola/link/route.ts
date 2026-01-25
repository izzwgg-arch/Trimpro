import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { solaService } from '@/lib/services/sola'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const { invoiceId, returnUrl, webhookUrl } = body

    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 })
    }

    // Get invoice
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId: user.tenantId,
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
      return NextResponse.json({ error: 'Invoice is already paid' }, { status: 400 })
    }

    // Create payment link with SOLA
    const paymentLink = await solaService.createPaymentLink({
      invoiceId: invoice.id,
      amount: Number(invoice.balance),
      description: `Invoice ${invoice.invoiceNumber} - ${invoice.title}`,
      clientEmail: invoice.client.email || invoice.client.contacts[0]?.email || undefined,
      clientName: invoice.client.name,
      returnUrl: returnUrl || `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/invoices/${invoice.id}`,
      webhookUrl: webhookUrl || `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/sola`,
    })

    // Store payment link reference
    // You might want to create a PaymentLink record in the database

    return NextResponse.json({
      paymentLink: paymentLink.url,
      expiresAt: paymentLink.expiresAt,
    })
  } catch (error: any) {
    console.error('Create SOLA payment link error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create payment link' },
      { status: 500 }
    )
  }
}
