import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { verifySolaWebhookSignature } from '@/lib/integrations/providers/sola'
import { notifyInvoicePaid } from '@/lib/notifications'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    let body: Record<string, any> = {}
    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      const params = new URLSearchParams(rawBody)
      body = Object.fromEntries(params.entries())
    }
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

    if (webhookSecret && signature) {
      // Verify signature only when the provider includes one.
      const payload = JSON.stringify(body)
      const isValid = verifySolaWebhookSignature(payload, signature, webhookSecret)
      if (!isValid) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const event = body?.event || 'payment'
    const paymentId = body?.paymentId || body?.xRefnum || body?.xRefNum || body?.TransactionID || ''
    const invoiceId = body?.invoiceId || body?.xInvoice || body?.InvoiceID || ''
    const amount = Number(body?.amount || body?.xAmount || 0)
    const status = String(body?.status || body?.xResult || '').toLowerCase()
    const transactionId =
      body?.transactionId || body?.xRefnum || body?.xRefNum || body?.TransactionID || paymentId
    const timestamp = body?.timestamp || new Date().toISOString()

    // Use tenant from connection
    const tenantId = connection.tenantId

    // Find invoice by metadata or invoiceId
    const invoice = await prisma.invoice.findFirst({
      where: {
        tenantId,
        OR: [{ id: String(invoiceId) }, { invoiceNumber: String(invoiceId) }],
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
        solaTransactionId: String(transactionId || paymentId || ''),
      },
    })

    if (existingPayment) {
      // Update existing payment
      await prisma.payment.update({
        where: { id: existingPayment.id },
        data: {
          status: status === 'completed' ? 'COMPLETED' :
                  status === 'paid' ? 'COMPLETED' :
                  status === 'approved' ? 'COMPLETED' :
                  status === 's' ? 'COMPLETED' :
                  status === 'a' ? 'COMPLETED' :
                  status === 'pending' ? 'PENDING' :
                  status === 'failed' ? 'FAILED' :
                  'PENDING',
          processedAt:
            status === 'completed' || status === 'paid' || status === 'approved' || status === 's' || status === 'a'
              ? new Date(timestamp)
              : existingPayment.processedAt,
          solaWebhookData: body,
        },
      })

      return NextResponse.json({ message: 'Payment updated' })
    }

    // Create new payment record
    if (status === 'completed' || status === 'paid' || status === 'approved' || status === 's' || status === 'a') {
      const payment = await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: amount || Number(invoice.balance),
          status: 'COMPLETED',
          method: 'CARD', // SOLA typically processes card payments
          provider: 'sola',
          providerPaymentId: String(transactionId || paymentId || ''),
          providerInvoiceId: String(invoiceId || invoice.invoiceNumber || ''),
          reference: transactionId || paymentId,
          solaTransactionId: transactionId || paymentId,
          solaWebhookData: body,
          processedAt: new Date(timestamp),
        },
      })

      try {
        await enqueueQboSync(invoice.tenantId, 'payment', payment.id)
      } catch (error) {
        console.error('QuickBooks payment sync trigger error (legacy webhook):', error)
      }

      // Update invoice
      const newPaidAmount = Number(invoice.paidAmount) + (amount || Number(invoice.balance))
      const newBalance = Number(invoice.total) - newPaidAmount

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaidAmount,
          balance: newBalance,
          status:
            newBalance <= 0
              ? (invoice.progressBillingMode && invoice.progressBillingMode !== 'FULL' ? 'PARTIAL' : 'PAID')
              : newPaidAmount > 0
                ? 'PARTIAL'
                : invoice.status,
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
        amount || Number(invoice.balance),
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
