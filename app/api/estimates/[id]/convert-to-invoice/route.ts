import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { solaService } from '@/lib/services/sola'
import crypto from 'crypto'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { syncInvoiceToQuickBooks } from '@/lib/services/qbo-sync'

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
        optionalItems: {
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
      showDescriptionToCustomer: boolean
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
          showDescriptionToCustomer: (line as any).showDescriptionToCustomer ?? true,
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

    let result: any = null
    for (let attempt = 0; attempt < 300; attempt++) {
      try {
        result = await prisma.$transaction(async (tx) => {
          const latestInvoice = await tx.invoice.findFirst({
            where: { invoiceNumber: { startsWith: 'INV-' } },
            orderBy: { invoiceNumber: 'desc' },
            select: { invoiceNumber: true },
          })
          const latestNumMatch = latestInvoice?.invoiceNumber?.match(/^INV-(\d+)/)
          const latestNum = latestNumMatch ? parseInt(latestNumMatch[1], 10) : 0
          const baseNum = Number.isFinite(latestNum) ? latestNum : 0
          const invoiceNumber = `INV-${String(baseNum + 1 + attempt).padStart(6, '0')}`

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

          // Copy optional items from estimate (not included in invoice totals)
          if (estimate.optionalItems && estimate.optionalItems.length > 0) {
            for (let i = 0; i < estimate.optionalItems.length; i++) {
              const opt = estimate.optionalItems[i] as any
              await tx.invoiceOptionalLineItem.create({
                data: {
                  invoiceId: invoice.id,
                  // DocumentLineGroup ids are scoped to the source estimate; don't carry them over.
                  groupId: null,
                  description: opt.description,
                  quantity: opt.quantity,
                  unitPrice: opt.unitPrice,
                  unitCost: opt.unitCost || null,
                  total: opt.total,
                  sortOrder: opt.sortOrder ?? i,
                  isVisibleToClient: opt.isVisibleToClient !== false,
                  showDescriptionToCustomer: opt.showDescriptionToCustomer !== false,
                  showCostToCustomer: opt.showCostToCustomer !== undefined ? Boolean(opt.showCostToCustomer) : false,
                  showPriceToCustomer: opt.showPriceToCustomer !== undefined ? Boolean(opt.showPriceToCustomer) : true,
                  showTaxToCustomer: opt.showTaxToCustomer !== undefined ? Boolean(opt.showTaxToCustomer) : true,
                  showNotesToCustomer: opt.showNotesToCustomer !== undefined ? Boolean(opt.showNotesToCustomer) : false,
                  notes: opt.notes || null,
                  vendorId: opt.vendorId || null,
                  taxable: opt.taxable !== undefined ? Boolean(opt.taxable) : true,
                  taxRate: opt.taxRate || null,
                  sourceItemId: opt.sourceItemId || null,
                  sourceBundleId: opt.sourceBundleId || null,
                },
              })
            }
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
        break
      } catch (err: any) {
        if (err?.code === 'P2002' && err?.meta?.target?.includes?.('invoiceNumber')) {
          continue
        }
        throw err
      }
    }
    if (!result) {
      return NextResponse.json({ error: 'Unable to allocate a new invoice number. Please retry.' }, { status: 409 })
    }

    // Generate payment link immediately and store URL/transaction id
    try {
      const solaSecrets = await getIntegrationSecrets(user.tenantId, 'sola')
      if (!solaSecrets?.secretKey) {
        throw new Error('Sola integration is not configured (missing secret key).')
      }
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
        apiKey: solaSecrets.secretKey,
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

    try {
      await syncInvoiceToQuickBooks(user.tenantId, result.id)
    } catch (error) {
      console.error('QuickBooks invoice sync trigger error (estimate convert):', error)
    }

    return NextResponse.json({ invoice: result }, { status: 201 })
  } catch (error) {
    console.error('Convert estimate to invoice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

