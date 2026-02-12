import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { solaService } from '@/lib/services/sola'
import crypto from 'crypto'

type BillingMode = 'FULL' | 'PERCENTAGE' | 'MANUAL'

function toCents(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100)
}

function fromCents(cents: number) {
  return Number((cents / 100).toFixed(2))
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json().catch(() => ({}))
    const billingMode: BillingMode = body.billingMode || 'FULL'
    const percentage = Number(body.percentage || 0)
    const selectedLineItemIds: string[] = Array.isArray(body.selectedLineItemIds)
      ? body.selectedLineItemIds
      : []

    const estimate = await prisma.estimate.findFirst({
      where: {
        id: params.id,
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
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    if (!estimate.clientId || !estimate.client) {
      return NextResponse.json(
        { error: 'Estimate must be linked to a client before converting to invoice.' },
        { status: 400 }
      )
    }

    const estimateTotalCents = toCents(Number(estimate.total))
    let invoiceLineItems: Array<{
      description: string
      quantity: number
      unitPrice: number
      unitCost: number | null
      total: number
      sortOrder: number
      isVisibleToClient: boolean
      showCostToCustomer: boolean
      showPriceToCustomer: boolean
      showTaxToCustomer: boolean
      showNotesToCustomer: boolean
      notes: string | null
      vendorId: string | null
      taxable: boolean
      taxRate: number | null
      sourceItemId: string | null
      sourceBundleId: string | null
    }> = []
    let subtotalCents = 0
    let progressPercent = 0

    if (billingMode === 'PERCENTAGE') {
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
        return NextResponse.json({ error: 'Percentage must be between 0 and 100.' }, { status: 400 })
      }
      progressPercent = percentage
      subtotalCents = Math.max(0, Math.round(estimateTotalCents * (percentage / 100)))
      invoiceLineItems = [
        {
          description: `Progress Billing (${percentage.toFixed(2)}%) - Estimate ${estimate.estimateNumber}`,
          quantity: 1,
          unitPrice: fromCents(subtotalCents),
          unitCost: null,
          total: fromCents(subtotalCents),
          sortOrder: 0,
          isVisibleToClient: true,
          showCostToCustomer: false,
          showPriceToCustomer: true,
          showTaxToCustomer: true,
          showNotesToCustomer: false,
          notes: null,
          vendorId: null,
          taxable: false,
          taxRate: null,
          sourceItemId: null,
          sourceBundleId: null,
        },
      ]
    } else {
      const sourceLines =
        billingMode === 'MANUAL'
          ? estimate.lineItems.filter((li) => selectedLineItemIds.includes(li.id))
          : estimate.lineItems

      if (sourceLines.length === 0) {
        return NextResponse.json({ error: 'No line items selected to bill.' }, { status: 400 })
      }

      invoiceLineItems = sourceLines.map((line, idx) => {
        const lineTotal = Number(line.total)
        subtotalCents += toCents(lineTotal)
        return {
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          unitCost: line.unitCost ? Number(line.unitCost) : null,
          total: lineTotal,
          sortOrder: idx,
          isVisibleToClient: line.isVisibleToClient,
          showCostToCustomer: line.showCostToCustomer,
          showPriceToCustomer: line.showPriceToCustomer,
          showTaxToCustomer: line.showTaxToCustomer,
          showNotesToCustomer: line.showNotesToCustomer,
          notes: line.notes || null,
          vendorId: line.vendorId || null,
          taxable: line.taxable,
          taxRate: line.taxRate ? Number(line.taxRate) : null,
          sourceItemId: line.sourceItemId || null,
          sourceBundleId: line.sourceBundleId || null,
        }
      })
    }

    const subtotal = fromCents(subtotalCents)
    const taxRate = Number(estimate.taxRate || 0)
    const taxAmount = fromCents(Math.round(subtotalCents * taxRate))
    const discount = 0
    const total = fromCents(subtotalCents + toCents(taxAmount))
    const paymentToken = crypto.randomBytes(20).toString('hex')

    const result = await prisma.$transaction(async (tx) => {
      const invoiceCount = await tx.invoice.count({
        where: { tenantId: user.tenantId },
      })
      const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(6, '0')}`

      const invoice = await tx.invoice.create({
        data: {
          tenantId: user.tenantId,
          clientId: estimate.clientId!,
          estimateId: estimate.id,
          invoiceNumber,
          title: `${estimate.title} - ${billingMode === 'FULL' ? 'Full Billing' : billingMode === 'PERCENTAGE' ? `${percentage.toFixed(2)}% Billing` : 'Partial Billing'}`,
          status: 'DRAFT',
          subtotal,
          taxRate,
          taxAmount,
          discount,
          total,
          paidAmount: 0,
          balance: total,
          progressBillingMode: billingMode,
          progressBillingPercent: progressPercent || null,
          paymentToken,
          invoiceDate: new Date(),
          notes: estimate.notes || null,
          terms: estimate.terms || null,
        },
      })

      for (const line of invoiceLineItems) {
        await tx.invoiceLineItem.create({
          data: {
            invoiceId: invoice.id,
            ...line,
          },
        })
      }

      await tx.activity.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: 'INVOICE_CREATED',
          description: `Estimate "${estimate.estimateNumber}" converted to invoice ${invoiceNumber} (${billingMode})`,
          clientId: estimate.clientId!,
          estimateId: estimate.id,
          invoiceId: invoice.id,
        },
      })

      return invoice
    })

    // Generate payment link immediately and store URL/transaction id
    try {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.PUBLIC_APP_URL ||
        process.env.APP_URL ||
        'https://app.trimprony.com'
      const link = await solaService.createPaymentLink({
        invoiceId: result.id,
        amount: Number(result.balance),
        description: `Invoice ${result.invoiceNumber} - ${result.title}`,
        clientEmail: estimate.client.email || estimate.client.contacts?.[0]?.email || undefined,
        clientName: estimate.client.name,
        returnUrl: `${appUrl}/portal/pay/${result.id}?token=${result.paymentToken}`,
        webhookUrl: `${appUrl}/api/webhooks/sola-payment`,
      })

      await prisma.invoice.update({
        where: { id: result.id },
        data: {
          solaPaymentUrl: link.url || null,
          solaTransactionId: link.id || null,
        },
      })
    } catch (error) {
      console.error('Failed to pre-generate SOLA payment link for converted invoice:', error)
    }

    return NextResponse.json({ invoice: result }, { status: 201 })
  } catch (error) {
    console.error('Convert estimate to invoice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

