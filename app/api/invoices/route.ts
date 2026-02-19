import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getPaginationParams, createPaginationResponse } from '@/lib/pagination'
import { validateRequest, createInvoiceSchema } from '@/lib/validation'
import crypto from 'crypto'
import { syncInvoiceToQuickBooks } from '@/lib/services/qbo-sync'
import { createAchPaymentSession } from '@/lib/qbo/payments-ach'

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

    // Calculate totals
    const subtotal = lineItems.reduce((sum: number, item: any) => {
      const qty = typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity || 0)
      const price = typeof item.unitPrice === 'number' ? item.unitPrice : parseFloat(item.unitPrice || 0)
      return sum + (qty * price)
    }, 0)

    const discountAmount = discount ? (typeof discount === 'number' ? discount : parseFloat(discount)) : 0
    const subtotalAfterDiscount = subtotal - discountAmount
    const taxRateValue = taxRate ? (typeof taxRate === 'number' ? taxRate : parseFloat(taxRate)) : 0
    const tax = subtotalAfterDiscount * taxRateValue
    const total = subtotalAfterDiscount + tax

    // Generate invoice number with global collision-safe retry.
    // invoiceNumber is globally unique in schema, so tenant-local counters can collide.
    const latestInvoice = await prisma.invoice.findFirst({
      where: { invoiceNumber: { startsWith: 'INV-' } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    })
    const latestNum = latestInvoice?.invoiceNumber
      ? parseInt(latestInvoice.invoiceNumber.replace(/^INV-/, ''), 10)
      : 0
    const startNum = Number.isFinite(latestNum) ? latestNum : 0
    let invoiceNumber = ''
    let invoice: any = null
    for (let attempt = 0; attempt < 300; attempt++) {
      invoiceNumber = `INV-${String(startNum + 1 + attempt).padStart(6, '0')}`
      try {
        invoice = await prisma.invoice.create({
          data: {
            tenantId: user.tenantId,
            clientId,
            jobId: jobId || null,
            estimateId: estimateId || null,
            invoiceNumber,
            title,
            status: 'DRAFT',
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
          },
          include: {
            client: true,
            job: true,
          },
        })
        break
      } catch (err: any) {
        if (err?.code === 'P2002' && err?.meta?.target?.includes?.('invoiceNumber')) {
          continue
        }
        throw err
      }
    }
    if (!invoice) {
      // Last-resort unique fallback to guarantee create path never deadlocks on numbering.
      const suffix = crypto.randomBytes(3).toString('hex').toUpperCase()
      invoiceNumber = `INV-${String(startNum + 1).padStart(6, '0')}-${suffix}`
      invoice = await prisma.invoice.create({
        data: {
          tenantId: user.tenantId,
          clientId,
          jobId: jobId || null,
          estimateId: estimateId || null,
          invoiceNumber,
          title,
          status: 'DRAFT',
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
          qboAchEnabled: true,
        },
        include: {
          client: true,
          job: true,
        },
      })
    }

    // Link estimate if provided
    if (estimateId) {
      await prisma.estimate.update({
        where: { id: estimateId },
        data: {
          status: 'CONVERTED',
          jobId: jobId || null,
        },
      })
    }

    // Create document line groups first (for bundles)
    const groupMap = new Map<string, string>() // groupId -> database group ID
    if (groups && Array.isArray(groups)) {
      for (const group of groups) {
        const dbGroup = await prisma.documentLineGroup.create({
          data: {
            tenantId: user.tenantId,
            documentType: 'INVOICE',
            documentId: invoice.id,
            name: group.name || 'Bundle',
            sourceBundleId: group.sourceBundleId || null,
            sourceBundleName: group.name || null,
          },
        })
        groupMap.set(group.groupId, dbGroup.id)
      }
    }

    // Create line items
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i]
      const qty = typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity || 0)
      const price = typeof item.unitPrice === 'number' ? item.unitPrice : parseFloat(item.unitPrice || 0)
      const itemTotal = qty * price

      // Get groupId from map if item has a groupId
      const dbGroupId = item.groupId ? groupMap.get(item.groupId) || null : null

      await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          groupId: dbGroupId,
          description: item.description,
          quantity: qty,
          unitPrice: price,
          unitCost: item.unitCost ? (typeof item.unitCost === 'number' ? item.unitCost : parseFloat(item.unitCost)) : null,
          total: itemTotal,
          sortOrder: i,
          isVisibleToClient: item.isVisibleToClient !== undefined ? Boolean(item.isVisibleToClient) : true,
          // New per-field visibility flags
          showDescriptionToCustomer:
            item.showDescriptionToCustomer !== undefined ? Boolean(item.showDescriptionToCustomer) : true,
          showCostToCustomer: item.showCostToCustomer !== undefined ? Boolean(item.showCostToCustomer) : false,
          showPriceToCustomer: item.showPriceToCustomer !== undefined ? Boolean(item.showPriceToCustomer) : true,
          showTaxToCustomer: item.showTaxToCustomer !== undefined ? Boolean(item.showTaxToCustomer) : true,
          showNotesToCustomer: item.showNotesToCustomer !== undefined ? Boolean(item.showNotesToCustomer) : false,
          // Additional fields
          vendorId: item.vendorId || null,
          taxable: item.taxable !== undefined ? Boolean(item.taxable) : true,
          taxRate: item.taxRate ? (typeof item.taxRate === 'number' ? item.taxRate : parseFloat(item.taxRate)) : null,
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

        await prisma.invoiceOptionalLineItem.create({
          data: {
            invoiceId: invoice.id,
            groupId: dbGroupId,
            description: item.description,
            quantity: qty,
            unitPrice: price,
            unitCost: item.unitCost ? (typeof item.unitCost === 'number' ? item.unitCost : parseFloat(item.unitCost)) : null,
            total: itemTotal,
            sortOrder: i,
            isVisibleToClient: item.isVisibleToClient !== undefined ? Boolean(item.isVisibleToClient) : true,
            showDescriptionToCustomer:
              item.showDescriptionToCustomer !== undefined ? Boolean(item.showDescriptionToCustomer) : true,
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
      await syncInvoiceToQuickBooks(user.tenantId, invoice.id)
    } catch (error) {
      console.error('QuickBooks invoice sync trigger error:', error)
    }

    // Best-effort: automatically generate the QuickBooks ACH hosted payment link after sync.
    // This pre-populates the ACH button without any manual checkbox/toggle.
    try {
      const achEnabled = String(process.env.QUICKBOOKS_ACH_ENABLED || '').toLowerCase()
      if (achEnabled === 'true' || achEnabled === '1' || achEnabled === 'yes') {
        await createAchPaymentSession({
          tenantId: user.tenantId,
          invoiceId: invoice.id,
          createdById: user.id,
        })
      }
    } catch (error) {
      // Don't block invoice creation if QBO Payments isn't enabled/configured yet.
      console.warn('QuickBooks ACH session auto-create skipped:', (error as any)?.message || error)
    }

    return NextResponse.json({ invoice }, { status: 201 })
  } catch (error) {
    console.error('Create invoice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
