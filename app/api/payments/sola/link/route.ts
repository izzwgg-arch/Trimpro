import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { solaService } from '@/lib/services/sola'
import { getIntegrationSecrets } from '@/lib/integrations/status'

function toCents(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100)
}

function fromCents(cents: number) {
  return Number((cents / 100).toFixed(2))
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const { invoiceId, returnUrl, webhookUrl, billRest = false } = body
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.PUBLIC_APP_URL ||
      process.env.APP_URL ||
      'https://app.trimprony.com'

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

    const solaSecrets = await getIntegrationSecrets(user.tenantId, 'sola')
    if (!solaSecrets?.secretKey) {
      return NextResponse.json({ error: 'Sola integration is not configured (missing secret key).' }, { status: 400 })
    }

    let amountToBill = Number(invoice.balance)

    if (billRest) {
      if (!invoice.estimateId) {
        return NextResponse.json(
          { error: 'Bill the Rest requires an invoice linked to an estimate.' },
          { status: 400 }
        )
      }

      const estimate = await prisma.estimate.findFirst({
        where: {
          id: invoice.estimateId,
          tenantId: user.tenantId,
        },
      })

      if (!estimate) {
        return NextResponse.json({ error: 'Linked estimate not found' }, { status: 404 })
      }

      const paidAgg = await prisma.payment.aggregate({
        where: {
          invoice: {
            estimateId: estimate.id,
            tenantId: user.tenantId,
          },
          status: 'COMPLETED',
        },
        _sum: { amount: true },
      })

      const estimateTotalCents = toCents(Number(estimate.total))
      const paidCents = toCents(Number(paidAgg._sum.amount || 0))
      const remainingCents = Math.max(0, estimateTotalCents - paidCents)
      amountToBill = fromCents(remainingCents)

      await prisma.$transaction(async (tx) => {
        await tx.invoiceLineItem.deleteMany({
          where: { invoiceId: invoice.id },
        })

        await tx.invoiceLineItem.create({
          data: {
            invoiceId: invoice.id,
            description: `Remaining Balance - Estimate ${estimate.estimateNumber}`,
            quantity: 1,
            unitPrice: amountToBill,
            unitCost: null,
            total: amountToBill,
            sortOrder: 0,
            taxable: false,
            isVisibleToClient: true,
            showCostToCustomer: false,
            showPriceToCustomer: true,
            showTaxToCustomer: true,
            showNotesToCustomer: false,
          },
        })

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            subtotal: amountToBill,
            taxAmount: 0,
            discount: 0,
            taxRate: 0,
            total: amountToBill,
            balance: amountToBill,
            isBillRest: true,
          },
        })
      })
    }

    // Create payment link with SOLA
    const paymentLink = await solaService.createPaymentLink({
      invoiceId: invoice.id,
      amount: amountToBill,
      description: `Invoice ${invoice.invoiceNumber} - ${invoice.title}`,
      clientEmail: invoice.client.email || invoice.client.contacts[0]?.email || undefined,
      clientName: invoice.client.name,
      returnUrl: returnUrl || `${appUrl}/portal/pay/${invoice.id}?token=${invoice.paymentToken || ''}`,
      webhookUrl: webhookUrl || `${appUrl}/api/webhooks/sola-payment`,
      apiKey: solaSecrets.secretKey,
    })

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        solaPaymentUrl: paymentLink.url || null,
        solaTransactionId: paymentLink.id || null,
      },
    })

    const hostedUrl = `${appUrl}/portal/pay/${invoice.id}?token=${invoice.paymentToken || ''}`

    return NextResponse.json({
      paymentLink: hostedUrl,
      gatewayPaymentUrl: paymentLink.url,
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
