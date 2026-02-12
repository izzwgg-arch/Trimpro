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
        estimate: {
          select: {
            id: true,
            estimateNumber: true,
            total: true,
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
        unitCost: item.unitCost ? item.unitCost.toString() : null,
        total: item.total.toString(),
        isVisibleToClient: item.isVisibleToClient,
        // New visibility fields
        showCostToCustomer: item.showCostToCustomer ?? false,
        showPriceToCustomer: item.showPriceToCustomer ?? true,
        showTaxToCustomer: item.showTaxToCustomer ?? true,
        showNotesToCustomer: item.showNotesToCustomer ?? false,
        // Additional fields
        vendorId: item.vendorId || null,
        vendorName: item.vendor?.name || null,
        taxable: item.taxable ?? true,
        taxRate: item.taxRate ? item.taxRate.toString() : null,
        notes: item.notes || null,
        groupId: item.groupId || null,
        group: item.group ? {
          id: item.group.id,
          name: item.group.name,
          sourceBundleId: item.group.sourceBundleId,
          sourceBundleName: item.group.sourceBundleName,
        } : null,
        sourceItemId: item.sourceItemId || null,
        sourceBundleId: item.sourceBundleId || null,
        sourceItem: item.sourceItem ? {
          id: item.sourceItem.id,
          name: item.sourceItem.name,
          kind: item.sourceItem.kind,
        } : null,
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
      groups, // Array of { groupId, name, sourceBundleId }
      taxRate,
      discount,
      status,
      invoiceDate,
      dueDate,
      notes,
      isNotesVisibleToClient,
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

      // Delete existing groups and line items
      await prisma.documentLineGroup.deleteMany({
        where: {
          tenantId: user.tenantId,
          documentType: 'INVOICE',
          documentId: params.id,
        },
      })
      await prisma.invoiceLineItem.deleteMany({
        where: { invoiceId: params.id },
      })

      // Create new groups
      const groupMap = new Map<string, string>() // groupId -> database group ID
      if (groups && Array.isArray(groups)) {
        for (const group of groups) {
          const dbGroup = await prisma.documentLineGroup.create({
            data: {
              tenantId: user.tenantId,
              documentType: 'INVOICE',
              documentId: params.id,
              name: group.name || 'Bundle',
              sourceBundleId: group.sourceBundleId || null,
              sourceBundleName: group.name || null,
            },
          })
          groupMap.set(group.groupId, dbGroup.id)
        }
      }

      // Create new line items
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i]
        const qty = parseFloat(item.quantity || 0)
        const price = parseFloat(item.unitPrice || 0)
        const itemTotal = qty * price

        // Get groupId from map if item has a groupId
        const dbGroupId = item.groupId ? groupMap.get(item.groupId) || null : null

        await prisma.invoiceLineItem.create({
          data: {
            invoiceId: params.id,
            groupId: dbGroupId,
            description: item.description,
            quantity: qty,
            unitPrice: price,
            unitCost: item.unitCost ? parseFloat(item.unitCost) : null,
            total: itemTotal,
            sortOrder: i,
            isVisibleToClient: item.isVisibleToClient !== undefined ? Boolean(item.isVisibleToClient) : true,
            // New per-field visibility flags
            showCostToCustomer: item.showCostToCustomer !== undefined ? Boolean(item.showCostToCustomer) : false,
            showPriceToCustomer: item.showPriceToCustomer !== undefined ? Boolean(item.showPriceToCustomer) : true,
            showTaxToCustomer: item.showTaxToCustomer !== undefined ? Boolean(item.showTaxToCustomer) : true,
            showNotesToCustomer: item.showNotesToCustomer !== undefined ? Boolean(item.showNotesToCustomer) : false,
            // Additional fields
            vendorId: item.vendorId || null,
            taxable: item.taxable !== undefined ? Boolean(item.taxable) : true,
            taxRate: item.taxRate ? parseFloat(item.taxRate) : null,
            notes: item.notes || null,
            sourceItemId: item.sourceItemId || null,
            sourceBundleId: item.sourceBundleId || null,
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
        isNotesVisibleToClient:
          isNotesVisibleToClient !== undefined ? Boolean(isNotesVisibleToClient) : existing.isNotesVisibleToClient,
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

    // Delete invoice line items first (cascade should handle this, but being explicit)
    await prisma.invoiceLineItem.deleteMany({
      where: { invoiceId: params.id },
    })

    // Actually delete the invoice
    await prisma.invoice.delete({
      where: { id: params.id },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'DELETE',
        entityType: 'Invoice',
        entityId: invoice.id,
      },
    })

    return NextResponse.json({ message: 'Invoice deleted successfully' })
  } catch (error) {
    console.error('Delete invoice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
