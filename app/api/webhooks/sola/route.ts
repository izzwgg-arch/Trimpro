import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { verifySolaWebhookSignature } from '@/lib/integrations/providers/sola'
import { notifyInvoicePaid } from '@/lib/notifications'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const signature = request.headers.get('x-sola-signature') || ''

    // Find Sola integration to get webhook secret
    const solaConnections = await prisma.integrationConnection.findMany({
      where: { provider: 'sola', status: 'CONNECTED' },
    })

    if (solaConnections.length === 0) {
      return NextResponse.json({ error: 'Sola integration not configured' }, { status: 404 })
    }

    // Use first connection (in production, match by merchant ID or tenant)
    const connection = solaConnections[0]
    const secrets = await getIntegrationSecrets(connection.tenantId, 'sola')
    const webhookSecret = secrets?.webhookSecret

    if (!webhookSecret) {
      console.error('Sola webhook secret not found')
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 })
    }

    // Verify webhook signature
    const payload = JSON.stringify(body)
    const isValid = verifySolaWebhookSignature(payload, signature, webhookSecret)

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const { event, paymentId, invoiceId, amount, status, transactionId, timestamp } = body

    // Use tenant from connection
    const tenantId = connection.tenantId

    // Find invoice by metadata or invoiceId
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId,
      },
      include: {
        tenant: true,
        client: true,
      },
    })

    if (!invoice) {
      console.error('Invoice not found for SOLA webhook:', invoiceId)
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Check if payment already exists
    const existingPayment = await prisma.payment.findFirst({
      where: {
        solaTransactionId: transactionId || paymentId,
      },
    })

    if (existingPayment) {
      // Update existing payment
      await prisma.payment.update({
        where: { id: existingPayment.id },
        data: {
          status: status === 'completed' ? 'COMPLETED' :
                  status === 'pending' ? 'PENDING' :
                  status === 'failed' ? 'FAILED' :
                  'PENDING',
          processedAt: status === 'completed' ? new Date(timestamp) : existingPayment.processedAt,
          solaWebhookData: body,
        },
      })

      return NextResponse.json({ message: 'Payment updated' })
    }

    // Create new payment record
    if (status === 'completed' || status === 'paid') {
      const payment = await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: parseFloat(amount),
          status: 'COMPLETED',
          method: 'CARD', // SOLA typically processes card payments
          reference: transactionId || paymentId,
          solaTransactionId: transactionId || paymentId,
          solaWebhookData: body,
          processedAt: new Date(timestamp),
        },
      })

      // Update invoice
      const newPaidAmount = Number(invoice.paidAmount) + parseFloat(amount)
      const newBalance = Number(invoice.total) - newPaidAmount

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaidAmount,
          balance: newBalance,
          status: newBalance <= 0 ? 'PAID' : newPaidAmount > 0 ? 'PARTIAL' : invoice.status,
          paidAt: newBalance <= 0 ? new Date(timestamp) : invoice.paidAt,
        },
      })

      // Create activity
      await prisma.activity.create({
        data: {
          tenantId: invoice.tenantId,
          type: 'PAYMENT_RECEIVED',
          description: `Payment of ${amount} received for invoice ${invoice.invoiceNumber}`,
          invoiceId: invoice.id,
          paymentId: payment.id,
          clientId: invoice.clientId,
        },
      })

      // Notify accounting users about payment
      await notifyInvoicePaid(
        invoice.tenantId,
        invoice.id,
        invoice.invoiceNumber,
        parseFloat(amount),
        invoice.client.name
      )

      // Trigger automations
      // TODO: Check for automations with PAYMENT_RECEIVED trigger
    }

    return NextResponse.json({ message: 'Webhook processed successfully' })
  } catch (error) {
    console.error('SOLA webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET endpoint for webhook verification (if SOLA requires it)
export async function GET(request: NextRequest) {
  return NextResponse.json({ message: 'SOLA webhook endpoint' })
}
