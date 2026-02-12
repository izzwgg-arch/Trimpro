import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const job = await prisma.job.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        estimate: {
          include: {
            lineItems: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (!job.estimate || job.estimate.lineItems.length === 0) {
      return NextResponse.json(
        { error: 'This job has no linked estimate with line items to invoice.' },
        { status: 400 }
      )
    }

    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceCount = await tx.invoice.count({
        where: { tenantId: user.tenantId },
      })
      const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(6, '0')}`

      const estimateLineItems = job.estimate!.lineItems
      const subtotal = estimateLineItems.reduce((sum, line) => sum + Number(line.total), 0)
      const discount = Number(job.estimate!.discount || 0)
      const subtotalAfterDiscount = subtotal - discount
      const taxRate = Number(job.estimate!.taxRate || 0)
      const taxAmount = subtotalAfterDiscount * taxRate
      const total = subtotalAfterDiscount + taxAmount

      const createdInvoice = await tx.invoice.create({
        data: {
          tenantId: user.tenantId,
          clientId: job.clientId,
          jobId: job.id,
          invoiceNumber,
          title: job.estimate!.title || `Invoice for ${job.title}`,
          status: 'DRAFT',
          subtotal,
          taxRate,
          taxAmount,
          discount,
          total,
          paidAmount: 0,
          balance: total,
          invoiceDate: new Date(),
          notes: job.estimate!.notes || null,
          terms: job.estimate!.terms || null,
        },
      })

      for (const line of estimateLineItems) {
        await tx.invoiceLineItem.create({
          data: {
            invoiceId: createdInvoice.id,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unitCost: line.unitCost,
            total: line.total,
            sortOrder: line.sortOrder,
            isVisibleToClient: line.isVisibleToClient,
            showCostToCustomer: line.showCostToCustomer,
            showPriceToCustomer: line.showPriceToCustomer,
            showTaxToCustomer: line.showTaxToCustomer,
            showNotesToCustomer: line.showNotesToCustomer,
            notes: line.notes,
            vendorId: line.vendorId,
            taxable: line.taxable,
            taxRate: line.taxRate,
            sourceItemId: line.sourceItemId,
            sourceBundleId: line.sourceBundleId,
          },
        })
      }

      await tx.estimate.update({
        where: { id: job.estimate!.id },
        data: { status: 'CONVERTED' },
      })

      await tx.job.update({
        where: { id: job.id },
        data: { status: 'INVOICED' },
      })

      await tx.activity.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: 'INVOICE_CREATED',
          description: `Job "${job.jobNumber}" converted to invoice ${invoiceNumber}`,
          clientId: job.clientId,
          jobId: job.id,
          estimateId: job.estimate!.id,
          invoiceId: createdInvoice.id,
        },
      })

      return createdInvoice
    })

    return NextResponse.json({ invoice }, { status: 201 })
  } catch (error) {
    console.error('Convert job to invoice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
