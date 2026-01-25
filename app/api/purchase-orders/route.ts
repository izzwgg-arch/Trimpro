import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const vendorId = searchParams.get('vendorId') || ''
  const jobId = searchParams.get('jobId') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const skip = (page - 1) * limit

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (search) {
      where.OR = [
        { poNumber: { contains: search, mode: 'insensitive' } },
        { vendor: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status !== 'all') {
      where.status = status
    }

    if (vendorId) {
      where.vendorId = vendorId
    }

    if (jobId) {
      where.jobId = jobId
    }

    const [purchaseOrders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          vendorRef: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              address: true,
              city: true,
              state: true,
              zipCode: true,
              contactPerson: true,
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
            orderBy: {
              sortOrder: 'asc',
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.purchaseOrder.count({ where }),
    ])

    // Calculate totals
    const purchaseOrdersWithTotals = purchaseOrders.map((po) => {
      const subtotal = po.lineItems.reduce((sum, item) => {
        return sum + (Number(item.quantity) * Number(item.unitPrice))
      }, 0)
      const total = subtotal

      return {
        ...po,
        subtotal,
        total,
      }
    })

    return NextResponse.json({
      purchaseOrders: purchaseOrdersWithTotals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Get purchase orders error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const {
      vendor,
      vendorId,
      poNumber,
      jobId,
      status,
      expectedDate,
      orderDate,
      lineItems,
      tax,
      shipping,
    } = body

    // Get vendor info if vendorId provided
    let vendorName = vendor
    if (vendorId) {
      const vendorRecord = await prisma.vendor.findFirst({
        where: {
          id: vendorId,
          tenantId: user.tenantId,
        },
      })
      if (!vendorRecord) {
        return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
      }
      vendorName = vendorRecord.name
    }

    if (!vendorName && !vendorId) {
      return NextResponse.json({ error: 'Vendor is required' }, { status: 400 })
    }

    // Generate PO number if not provided
    let finalPONumber = poNumber
    if (!finalPONumber) {
      const lastPO = await prisma.purchaseOrder.findFirst({
        where: { tenantId: user.tenantId },
        orderBy: { createdAt: 'desc' },
        select: { poNumber: true },
      })

      const nextNumber = lastPO
        ? parseInt(lastPO.poNumber.replace('PO-', '')) + 1
        : 1
      finalPONumber = `PO-${nextNumber.toString().padStart(6, '0')}`
    }

    // Calculate totals from line items
    const subtotal = lineItems && Array.isArray(lineItems)
      ? lineItems.reduce((sum, item) => sum + (parseFloat(item.quantity || 0) * parseFloat(item.unitPrice || 0)), 0)
      : 0
    const taxAmount = parseFloat(tax || 0)
    const shippingAmount = parseFloat(shipping || 0)
    const total = subtotal + taxAmount + shippingAmount

    // Create purchase order
    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        tenantId: user.tenantId,
        poNumber: finalPONumber,
        vendor: vendorName,
        vendorId: vendorId || null,
        jobId: jobId || null,
        status: status || 'DRAFT',
        orderDate: orderDate ? new Date(orderDate) : new Date(),
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        total,
      },
      include: {
        vendorRef: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            zipCode: true,
            contactPerson: true,
          },
        },
        job: {
          include: {
            client: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        lineItems: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    })

    // Create line items
    if (lineItems && Array.isArray(lineItems)) {
      for (const item of lineItems) {
        await prisma.purchaseOrderLineItem.create({
          data: {
            poId: purchaseOrder.id,
            description: item.description || '',
            quantity: parseFloat(item.quantity) || 1,
            unitPrice: parseFloat(item.unitPrice) || 0,
            total: parseFloat(item.quantity || 0) * parseFloat(item.unitPrice || 0),
            sortOrder: item.sortOrder || 0,
          },
        })
      }
    }

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'OTHER',
        description: `Purchase order ${finalPONumber} created`,
      },
    })

    // Calculate totals for response
    const responseSubtotal = purchaseOrder.lineItems.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.unitPrice))
    }, 0)

    return NextResponse.json({
      purchaseOrder: {
        ...purchaseOrder,
        subtotal: responseSubtotal,
        tax: taxAmount,
        shipping: shippingAmount,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Create purchase order error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
