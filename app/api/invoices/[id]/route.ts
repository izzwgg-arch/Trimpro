import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { notifyInvoiceOverdue } from '@/lib/notifications'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const invoice = await prisma.invoice.findFirst({
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
            addresses: {
              where: { type: 'billing' },
              take: 1,
            },
          },
        },
        job: {
          select: {
            id: true,
            jobNumber: true,
            title: true,
          },
        },
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          include: {
            invoice: {
              select: {
                invoiceNumber: true,
              },
            },
          },
        },
        attachments: {
          orderBy: { createdAt: 'desc' },
        },
        tasks: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Convert Decimal fields to strings for frontend
    const invoiceResponse = {
      ...invoice,
      subtotal: invoice.subtotal.toString(),
      taxRate: invoice.taxRate.toString(),
      taxAmount: invoice.taxAmount.toString(),
      discount: invoice.discount.toString(),
      total: invoice.total.toString(),
      balance: invoice.balance.toString(),
      paidAmount: invoice.paidAmount.toString(),
      lineItems: invoice.lineItems.map(item => ({
        ...item,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        total: item.total.toString(),
      })),
      payments: invoice.payments.map(payment => ({
        ...payment,
        amount: payment.amount.toString(),
      })),
    }

    return NextResponse.json({ invoice: invoiceResponse })
  } catch (error) {
    console.error('Get invoice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const {
      title,
      lineItems,
      taxRate,
      discount,
      status,
      invoiceDate,
      dueDate,
      notes,
      terms,
      memo,
    } = body

    // Get existing invoice
    const existing = await prisma.invoice.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        lineItems: true,
        payments: true,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Don't allow editing paid invoices
    if (existing.status === 'PAID') {
      return NextResponse.json({ error: 'Cannot edit paid invoice' }, { status: 400 })
    }

    // Recalculate totals if line items changed
    let subtotal = Number(existing.subtotal)
    let discountAmount = Number(existing.discount || 0)
    let taxRateNum = Number(existing.taxRate || 0)

    if (lineItems && Array.isArray(lineItems)) {
      subtotal = lineItems.reduce((sum: number, item: any) => {
        const qty = parseFloat(item.quantity || 0)
        const price = parseFloat(item.unitPrice || 0)
        return sum + (qty * price)
      }, 0)

      // Update line items
      await prisma.invoiceLineItem.deleteMany({
        where: { invoiceId: params.id },
      })

      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i]
        const qty = parseFloat(item.quantity || 0)
        const price = parseFloat(item.unitPrice || 0)
        const itemTotal = qty * price

        await prisma.invoiceLineItem.create({
          data: {
            invoiceId: params.id,
            description: item.description,
            quantity: qty,
            unitPrice: price,
            total: itemTotal,
            sortOrder: i,
          },
        })
      }
    }

    if (discount !== undefined) {
      discountAmount = parseFloat(discount)
    }

    if (taxRate !== undefined) {
      taxRateNum = parseFloat(taxRate)
    }

    const subtotalAfterDiscount = subtotal - discountAmount
    const tax = subtotalAfterDiscount * taxRateNum
    const total = subtotalAfterDiscount + tax
    const paidAmount = Number(existing.paidAmount || 0)
    const balance = total - paidAmount

    // Update invoice
    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        title: title !== undefined ? title : existing.title,
        subtotal: subtotal,
        taxRate: taxRateNum,
        taxAmount: tax,
        discount: discountAmount,
        total: total,
        balance: balance,
        status: status !== undefined ? status : existing.status,
        invoiceDate: invoiceDate !== undefined ? (invoiceDate ? new Date(invoiceDate) : existing.invoiceDate) : existing.invoiceDate,
        dueDate: dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : existing.dueDate,
        notes: notes !== undefined ? notes : existing.notes,
        terms: terms !== undefined ? terms : existing.terms,
        memo: memo !== undefined ? memo : existing.memo,
      },
      include: {
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    // Update status to overdue if past due date
    if (invoice.dueDate && invoice.balance.toNumber() > 0 && new Date(invoice.dueDate) < new Date() && invoice.status !== 'PAID') {
      const wasOverdue = invoice.status === 'OVERDUE'
      await prisma.invoice.update({
        where: { id: params.id },
        data: { status: 'OVERDUE' },
      })
      invoice.status = 'OVERDUE'

      // Notify if status just changed to overdue
      if (!wasOverdue && invoice.client) {
        const daysOverdue = Math.floor((new Date().getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24))
        await notifyInvoiceOverdue(
          user.tenantId,
          invoice.id,
          invoice.invoiceNumber,
          invoice.client.name,
          daysOverdue
        )
      }
    }

    return NextResponse.json({ invoice })
  } catch (error) {
    console.error('Update invoice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Don't delete if has payments
    const paymentCount = await prisma.payment.count({
      where: { invoiceId: params.id },
    })

    if (paymentCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete invoice with payments. Cancel it instead.' },
        { status: 400 }
      )
    }

    // Update status to cancelled instead of deleting
    await prisma.invoice.update({
      where: { id: params.id },
      data: { status: 'CANCELLED' },
    })

    return NextResponse.json({ message: 'Invoice cancelled successfully' })
  } catch (error) {
    console.error('Delete invoice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
