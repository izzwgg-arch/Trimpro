import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getPaginationParams, createPaginationResponse } from '@/lib/pagination'
import { validateRequest, createInvoiceSchema } from '@/lib/validation'

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
      where.status = status
    }

    if (clientId) {
      where.clientId = clientId
    }

    const [invoices, total] = await Promise.all([
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
    ])

    return NextResponse.json({
      invoices,
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

  const {
    clientId,
    jobId,
    estimateId,
    title,
    lineItems: lineItemsFromData,
    items,
    taxRate,
    discount,
    invoiceDate,
    dueDate,
    notes,
    terms,
    memo,
  } = validation.data

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

    // Generate invoice number
    const invoiceCount = await prisma.invoice.count({
      where: { tenantId: user.tenantId },
    })
    const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(6, '0')}`

    // Create invoice
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: user.tenantId,
        clientId,
        jobId: jobId || null,
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
      },
      include: {
        client: true,
        job: true,
      },
    })

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

    // Create line items
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i]
      const qty = typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity || 0)
      const price = typeof item.unitPrice === 'number' ? item.unitPrice : parseFloat(item.unitPrice || 0)
      await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          description: item.description,
          quantity: qty,
          unitPrice: price,
          total: qty * price,
          sortOrder: i,
        },
      })
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

    return NextResponse.json({ invoice }, { status: 201 })
  } catch (error) {
    console.error('Create invoice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
