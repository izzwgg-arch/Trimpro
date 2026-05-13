import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getPaginationParams, createPaginationResponse } from '@/lib/pagination'
import { validateRequest, createInvoiceSchema } from '@/lib/validation'
import crypto from 'crypto'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import { createAchPaymentSession } from '@/lib/qbo/payments-ach'
import { calculateOrderedSubtotalRows } from '@/lib/documents/subtotals'
import {
  assertEstimateWillNotOverConvert,
  getEstimateConversionSummary,
} from '@/lib/documents/conversion'
import {
  allocateNextInvoiceNumber,
  assertInvoiceNumberAvailableInQuickBooks,
  normalizeInvoiceNumber,
} from '@/lib/qbo/doc-numbers'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const clientId = searchParams.get('clientId') || ''
  const { skip, take, page, limit } = getPaginationParams(searchParams)

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { client: { companyName: { contains: search, mode: 'insensitive' } } },
        { client: { addresses: { some: { street: { contains: search, mode: 'insensitive' } } } } },
        { client: { addresses: { some: { city: { contains: search, mode: 'insensitive' } } } } },
        { client: { addresses: { some: { state: { contains: search, mode: 'insensitive' } } } } },
        { client: { addresses: { some: { zipCode: { contains: search, mode: 'insensitive' } } } } },
      ]
    }

    if (status !== 'all') {
      if (status === 'UNPAID_OVERDUE') {
        where.status = {
          in: ['DRAFT', 'SENT', 'VIEWED', 'PARTIAL', 'OVERDUE'],
        }
      } else {
        where.status = status
      }
    }

    if (clientId) {
      where.clientId = clientId
    }

    const [invoices, total, allTimeTotal, allTimeOverdue, unpaidAgg, unpaidCount] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          client: {
            select: {
              id: true,
              name: true,
              companyName: true,
            },
          },
          job: {
            select: {
              id: true,
              jobNumber: true,
            },
          },
          estimate: {
            select: {
              id: true,
              estimateNumber: true,
            },
          },
          _count: {
            select: {
              lineItems: true,
              payments: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take,
      }),
      prisma.invoice.count({ where }),
      prisma.invoice.count({ where: { tenantId: user.tenantId } }),
      prisma.invoice.count({ where: { tenantId: user.tenantId, status: 'OVERDUE' as any } }),
      prisma.invoice.aggregate({
        where: {
          tenantId: user.tenantId,
          status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] as any },
          balance: { gt: 0 } as any,
        },
        _sum: { balance: true },
      }),
      prisma.invoice.count({
        where: {
          tenantId: user.tenantId,
          status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] as any },
          balance: { gt: 0 } as any,
        },
      }),
    ])

    return NextResponse.json({
      invoices,
      summary: {
        totalInvoicesAllTime: allTimeTotal,
        overdueCountAllTime: allTimeOverdue,
        unpaidCountAllTime: unpaidCount,
        totalUnpaidAllTime: Number((unpaidAgg as any)?._sum?.balance ?? 0),
      },
      pagination: createPaginationResponse(total, limit, skip),
    })
  } catch (error) {
    console.error('Get invoices error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  // Validate request body
  const validation = await validateRequest(request, createInvoiceSchema)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  const body = validation.data as any
  const {
    invoiceNumber: invoiceNumberOverride,
    clientId,
    jobId,
    estimateId,
    title,
    lineItems: lineItemsFromData,
    optionalItems,
    groups, // Array of { groupId, name, sourceBundleId }
    items,
    taxRate,
    discount,
    invoiceDate,
    dueDate,
    notes,
    terms,
    memo,
  } = body

  const lineItems = lineItemsFromData || items || []

  try {

    // Verify client belongs to tenant
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        tenantId: user.tenantId,
      },
    })

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    let reusableEmptyInvoice: { id: string; invoiceNumber: string } | null = null

    // Idempotency guard: if an invoice already exists for this estimate, return it rather
    // than creating a duplicate. Old broken conversions left behind empty DRAFT invoices
    // with zero items; those are treated as recoverable placeholders and will be reused.
    if (estimateId) {
      const existingInvoices = await prisma.invoice.findMany({
        where: { estimateId, tenantId: user.tenantId },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          createdAt: true,
          _count: {
            select: {
              lineItems: true,
              optionalItems: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      const validExisting = existingInvoices.find(
        (row) =>
          row.status !== 'DRAFT' ||
          row._count.lineItems > 0 ||
          row._count.optionalItems > 0
      )
      if (validExisting) {
        console.log(
          `[invoice-create] duplicate prevented for estimateId=${estimateId} → existing invoice ${validExisting.invoiceNumber}`
        )
        return NextResponse.json(
          {
            error: `An invoice already exists for this estimate (${validExisting.invoiceNumber}).`,
            invoiceId: validExisting.id,
          },
          { status: 409 }
        )
      }

      const recoverablePlaceholders = existingInvoices.filter(
        (row) =>
          row.status === 'DRAFT' &&
          row._count.lineItems === 0 &&
          row._count.optionalItems === 0
      )
      if (recoverablePlaceholders.length > 0) {
        reusableEmptyInvoice = {
          id: recoverablePlaceholders[0].id,
          invoiceNumber: recoverablePlaceholders[0].invoiceNumber,
        }
        console.log(
          `[invoice-create] reusing empty placeholder invoice ${reusableEmptyInvoice.invoiceNumber} for estimateId=${estimateId} (${recoverablePlaceholders.length} placeholder(s) found)`
        )
      }
    }

    // Defensive: prevent creating an empty invoice from an estimate conversion
    if (estimateId) {
      const realItems = lineItems.filter((item: any) => !item.isSubtotal)
      if (realItems.length === 0) {
        return NextResponse.json(
          { error: 'Cannot create invoice: no line items were provided from the estimate.' },
          { status: 400 }
        )
      }
    }

    const invoiceNumberOverrideTrimmed = normalizeInvoiceNumber(invoiceNumberOverride)

    // Calculate totals
    const subtotal = lineItems.reduce((sum: number, item: any) => {
      if (item?.isSubtotal) return sum
      const qty = typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity || 0)
      const price = typeof item.unitPrice === 'number' ? item.unitPrice : parseFloat(item.unitPrice || 0)
      return sum + (qty * price)
    }, 0)

    const discountAmount = discount ? (typeof discount === 'number' ? discount : parseFloat(discount)) : 0
    const subtotalAfterDiscount = subtotal - discountAmount
    const taxRateValue = taxRate ? (typeof taxRate === 'number' ? taxRate : parseFloat(taxRate)) : 0
    const tax = subtotalAfterDiscount * taxRateValue
    const total = subtotalAfterDiscount + tax

    const baseInvoiceData = {
      tenantId: user.tenantId,
      clientId,
      jobId: jobId || null,
      estimateId: estimateId || null,
      title,
      status: 'DRAFT' as const,
      subtotal: subtotal,
      taxRate: taxRateValue,
      taxAmount: tax,
      discount: discountAmount,
      total: total,
      balance: total,
      paidAmount: 0,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      notes: notes || null,
      terms: terms || null,
      memo: memo || null,
      paymentToken: crypto.randomBytes(20).toString('hex'),
      // ACH should be available by default (hosted by QuickBooks; no bank info stored by TrimPro).
      qboAchEnabled: true,
    }

    const runCreationTx = async (tx: any, inv: any) => {
      const groupMap = new Map<string, string>()

      // Create document line groups first (for bundles)
      if (groups && Array.isArray(groups)) {
        for (const group of groups) {
          const dbGroup = await tx.documentLineGroup.create({
            data: {
              tenantId: user.tenantId,
              documentType: 'INVOICE',
              documentId: inv.id,
              name: group.name || 'Bundle',
              sourceBundleId: group.sourceBundleId || null,
              sourceBundleName: group.name || null,
            },
          })
          groupMap.set(group.groupId, dbGroup.id)
        }
      }

      // Create line items. Subtotal rows are calculated from the preceding ordered segment.
      console.log(`[invoice-create] creating ${lineItems.length} line items for invoice ${inv.id}`)
      const calculatedLineItems = calculateOrderedSubtotalRows(lineItems as any[])
      for (let i = 0; i < calculatedLineItems.length; i++) {
        const item = calculatedLineItems[i]
        const qty = typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity || 0)
        const price = typeof item.unitPrice === 'number' ? item.unitPrice : parseFloat(item.unitPrice || 0)
        const itemTotal = item.calculatedSubtotalTotal
        const dbGroupId = item.groupId ? groupMap.get(item.groupId) || null : null
        const isSubtotalItem = Boolean(item.isSubtotal)
        await tx.invoiceLineItem.create({
          data: {
            invoiceId: inv.id,
            groupId: dbGroupId,
            description: isSubtotalItem ? 'Subtotal' : item.description,
            quantity: isSubtotalItem ? 0 : qty,
            unitPrice: isSubtotalItem ? 0 : price,
            unitCost: isSubtotalItem ? null : (item.unitCost ? (typeof item.unitCost === 'number' ? item.unitCost : parseFloat(item.unitCost)) : null),
            total: itemTotal,
            sortOrder: i,
            isSubtotal: isSubtotalItem,
            isVisibleToClient: item.isVisibleToClient !== undefined ? Boolean(item.isVisibleToClient) : true,
            showDescriptionToCustomer: item.showDescriptionToCustomer !== undefined ? Boolean(item.showDescriptionToCustomer) : true,
            showCostToCustomer: item.showCostToCustomer !== undefined ? Boolean(item.showCostToCustomer) : false,
            showPriceToCustomer: item.showPriceToCustomer !== undefined ? Boolean(item.showPriceToCustomer) : true,
            showTaxToCustomer: item.showTaxToCustomer !== undefined ? Boolean(item.showTaxToCustomer) : true,
            showNotesToCustomer: item.showNotesToCustomer !== undefined ? Boolean(item.showNotesToCustomer) : false,
            vendorId: isSubtotalItem ? null : (item.vendorId || null),
            taxable: isSubtotalItem ? false : (item.taxable !== undefined ? Boolean(item.taxable) : true),
            taxRate: isSubtotalItem ? null : (item.taxRate ? (typeof item.taxRate === 'number' ? item.taxRate : parseFloat(item.taxRate)) : null),
            notes: item.notes || null,
            sourceItemId: item.sourceItemId || null,
            sourceBundleId: item.sourceBundleId || null,
          },
        })
      }

      // Create optional line items (do NOT affect main totals)
      if (optionalItems && Array.isArray(optionalItems) && optionalItems.length > 0) {
        for (let i = 0; i < optionalItems.length; i++) {
          const item = optionalItems[i]
          const qty = typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity || 0)
          const price = typeof item.unitPrice === 'number' ? item.unitPrice : parseFloat(item.unitPrice || 0)
          const itemTotal = qty * price
          const dbGroupId = item.groupId ? groupMap.get(item.groupId) || null : null
          await tx.invoiceOptionalLineItem.create({
            data: {
              invoiceId: inv.id,
              groupId: dbGroupId,
              description: item.description,
              quantity: qty,
              unitPrice: price,
              unitCost: item.unitCost ? (typeof item.unitCost === 'number' ? item.unitCost : parseFloat(item.unitCost)) : null,
              total: itemTotal,
              sortOrder: i,
              isVisibleToClient: item.isVisibleToClient !== undefined ? Boolean(item.isVisibleToClient) : true,
              showDescriptionToCustomer: item.showDescriptionToCustomer !== undefined ? Boolean(item.showDescriptionToCustomer) : true,
              showCostToCustomer: item.showCostToCustomer !== undefined ? Boolean(item.showCostToCustomer) : false,
              showPriceToCustomer: item.showPriceToCustomer !== undefined ? Boolean(item.showPriceToCustomer) : true,
              showTaxToCustomer: item.showTaxToCustomer !== undefined ? Boolean(item.showTaxToCustomer) : true,
              showNotesToCustomer: item.showNotesToCustomer !== undefined ? Boolean(item.showNotesToCustomer) : false,
              vendorId: item.vendorId || null,
              taxable: item.taxable !== undefined ? Boolean(item.taxable) : true,
              taxRate: item.taxRate ? (typeof item.taxRate === 'number' ? item.taxRate : parseFloat(item.taxRate)) : null,
              notes: item.notes || null,
              sourceItemId: item.sourceItemId || null,
              sourceBundleId: item.sourceBundleId || null,
            },
          })
        }
      }

      // Link estimate if provided
      if (estimateId) {
        const estimate = await tx.estimate.findFirst({
          where: { id: estimateId, tenantId: user.tenantId },
          select: { id: true, total: true },
        })
        if (!estimate) {
          throw new Error('Estimate not found')
        }
        await assertEstimateWillNotOverConvert(tx, {
          estimateId,
          tenantId: user.tenantId,
          estimateTotal: estimate.total,
          newInvoiceTotal: total,
          excludeInvoiceId: inv.id,
        })
        const conversion = await getEstimateConversionSummary(tx, estimateId, estimate.total, user.tenantId)
        await tx.estimate.update({
          where: { id: estimateId },
          data: { status: 'CONVERTED', convertedPercent: conversion.convertedPercent, jobId: jobId || null },
        })
      }
    }

    const ensureEstimateStillAvailable = async (tx: any) => {
      if (!estimateId) return
      const otherInvoices = await tx.invoice.findMany({
        where: {
          estimateId,
          tenantId: user.tenantId,
          ...(reusableEmptyInvoice ? { id: { not: reusableEmptyInvoice.id } } : {}),
        },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          _count: {
            select: {
              lineItems: true,
              optionalItems: true,
            },
          },
        },
      })

      const blockingInvoice = otherInvoices.find(
        (row: any) =>
          row.status !== 'DRAFT' ||
          row._count.lineItems > 0 ||
          row._count.optionalItems > 0
      )
      if (blockingInvoice) {
        const err: any = new Error(`Invoice already exists for estimate (${blockingInvoice.invoiceNumber})`)
        err.code = 'ESTIMATE_INVOICE_EXISTS'
        err.invoiceId = blockingInvoice.id
        err.invoiceNumber = blockingInvoice.invoiceNumber
        throw err
      }
    }

    let invoiceNumber = ''
    let invoice: any = null

    if (reusableEmptyInvoice) {
      invoiceNumber = reusableEmptyInvoice.invoiceNumber
      try {
        await prisma.$transaction(async (tx) => {
          await ensureEstimateStillAvailable(tx)
          invoice = await tx.invoice.update({
            where: { id: reusableEmptyInvoice!.id },
            data: {
              ...baseInvoiceData,
              invoiceNumber: reusableEmptyInvoice!.invoiceNumber,
            },
            include: { client: true, job: true },
          })
          await tx.documentLineGroup.deleteMany({
            where: {
              documentType: 'INVOICE',
              documentId: invoice.id,
            },
          })
          await tx.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } })
          await tx.invoiceOptionalLineItem.deleteMany({ where: { invoiceId: invoice.id } })
          await runCreationTx(tx, invoice)
        }, { isolationLevel: 'Serializable' })
      } catch (err: any) {
        if (err?.code === 'ESTIMATE_INVOICE_EXISTS') {
          return NextResponse.json(
            {
              error: `An invoice already exists for this estimate (${err.invoiceNumber}).`,
              invoiceId: err.invoiceId,
            },
            { status: 409 }
          )
        }
        throw err
      }
    } else if (invoiceNumberOverrideTrimmed) {
      invoiceNumber = invoiceNumberOverrideTrimmed
      try {
        await assertInvoiceNumberAvailableInQuickBooks(user.tenantId, invoiceNumber)
      } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Invoice number already exists in QuickBooks' }, { status: 400 })
      }
      try {
        await prisma.$transaction(async (tx) => {
          await ensureEstimateStillAvailable(tx)
          invoice = await tx.invoice.create({
            data: { ...baseInvoiceData, invoiceNumber },
            include: { client: true, job: true },
          })
          await runCreationTx(tx, invoice)
        }, { isolationLevel: 'Serializable' })
      } catch (err: any) {
        if (err?.code === 'ESTIMATE_INVOICE_EXISTS') {
          return NextResponse.json(
            {
              error: `An invoice already exists for this estimate (${err.invoiceNumber}).`,
              invoiceId: err.invoiceId,
            },
            { status: 409 }
          )
        }
        if (err?.code === 'P2002' && err?.meta?.target?.includes?.('invoiceNumber')) {
          return NextResponse.json({ error: 'Invoice number already exists' }, { status: 400 })
        }
        throw err
      }
    } else {
      // Generate invoice number with local + QuickBooks collision-safe retry.
      for (let attempt = 0; attempt < 300; attempt++) {
        invoiceNumber = await allocateNextInvoiceNumber({ tenantId: user.tenantId })
        try {
          await prisma.$transaction(async (tx) => {
            await ensureEstimateStillAvailable(tx)
            invoice = await tx.invoice.create({
              data: { ...baseInvoiceData, invoiceNumber },
              include: { client: true, job: true },
            })
            await runCreationTx(tx, invoice)
          }, { isolationLevel: 'Serializable' })
          break
        } catch (err: any) {
          if (err?.code === 'ESTIMATE_INVOICE_EXISTS') {
            return NextResponse.json(
              {
                error: `An invoice already exists for this estimate (${err.invoiceNumber}).`,
                invoiceId: err.invoiceId,
              },
              { status: 409 }
            )
          }
          if (err?.code === 'P2002' && err?.meta?.target?.includes?.('invoiceNumber')) {
            invoice = null
            continue
          }
          throw err
        }
      }

      if (!invoice) {
        // Last-resort unique fallback to guarantee create path never deadlocks on numbering.
        const suffix = crypto.randomBytes(3).toString('hex').toUpperCase()
        invoiceNumber = `${await allocateNextInvoiceNumber({ tenantId: user.tenantId })}-${suffix}`
        await prisma.$transaction(async (tx) => {
          await ensureEstimateStillAvailable(tx)
          invoice = await tx.invoice.create({
            data: { ...baseInvoiceData, invoiceNumber },
            include: { client: true, job: true },
          })
          await runCreationTx(tx, invoice)
        }, { isolationLevel: 'Serializable' })
      }
    }

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'INVOICE_CREATED',
        description: `Invoice "${title}" created for ${client.name}`,
        invoiceId: invoice.id,
        clientId,
        jobId: jobId || undefined,
      },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'CREATE',
        entityType: 'Invoice',
        entityId: invoice.id,
        changes: {
          invoiceNumber,
          title,
          clientId,
          total,
        },
      },
    })

    try {
      await enqueueQboSync(user.tenantId, 'invoice', invoice.id)
    } catch (error) {
      console.error('QuickBooks invoice sync trigger error:', error)
    }

    // Best-effort: automatically generate the QuickBooks ACH hosted payment link after sync.
    // This must never block the invoice create response.
    try {
      const achEnabled = String(process.env.QUICKBOOKS_ACH_ENABLED || '').toLowerCase()
      if (achEnabled === 'true' || achEnabled === '1' || achEnabled === 'yes') {
        void createAchPaymentSession({
          tenantId: user.tenantId,
          invoiceId: invoice.id,
          createdById: user.id,
        }).catch((error) => {
          console.warn('QuickBooks ACH session auto-create skipped:', (error as any)?.message || error)
        })
      }
    } catch (error) {
      // Don't block invoice creation if QBO Payments isn't enabled/configured yet.
      console.warn('QuickBooks ACH session auto-create skipped:', (error as any)?.message || error)
    }

    return NextResponse.json({ invoice }, { status: 201 })
  } catch (error: any) {
    console.error('Create invoice error:', error)
    if (String(error?.message || '').includes('cannot exceed 100%')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
