import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
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
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20,
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

    if (!purchaseOrder) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    // Calculate totals
    const subtotal = purchaseOrder.lineItems.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.unitPrice))
    }, 0)
    const total = Number(purchaseOrder.total)
    const tax = 0 // Tax not stored in schema, would need migration
    const shipping = 0 // Shipping not stored in schema, would need migration
    const receivedTotal = 0 // Receipts tracking would require a separate model

    return NextResponse.json({
      purchaseOrder: {
        ...purchaseOrder,
        subtotal,
        tax,
        shipping,
        total,
        receivedTotal,
        balance: total - receivedTotal,
      },
    })
  } catch (error) {
    console.error('Get purchase order error:', error)
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
      vendor,
      vendorId,
      jobId,
      status,
      expectedDate,
      orderDate,
      lineItems,
      tax,
      shipping,
    } = body

    // Get existing PO
    const existing = await prisma.purchaseOrder.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    // Get vendor info if vendorId provided
    let vendorName = existing.vendor
    if (vendorId !== undefined) {
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
      } else {
        vendorName = vendor || existing.vendor
      }
    } else if (vendor !== undefined) {
      vendorName = vendor
    }

    // Calculate totals if line items updated
    let total = Number(existing.total)
    if (lineItems && Array.isArray(lineItems)) {
      const subtotal = lineItems.reduce((sum, item) => {
        return sum + (parseFloat(item.quantity || 0) * parseFloat(item.unitPrice || 0))
      }, 0)
      const taxAmount = parseFloat(tax || 0)
      const shippingAmount = parseFloat(shipping || 0)
      total = subtotal + taxAmount + shippingAmount
    }

    // Update purchase order
    const purchaseOrder = await prisma.purchaseOrder.update({
      where: { id: params.id },
      data: {
        vendor: vendorName,
        vendorId: vendorId !== undefined ? (vendorId || null) : existing.vendorId,
        jobId: jobId !== undefined ? (jobId || null) : existing.jobId,
        status: status !== undefined ? status : existing.status,
        orderDate: orderDate !== undefined ? (orderDate ? new Date(orderDate) : null) : existing.orderDate,
        expectedDate: expectedDate !== undefined ? (expectedDate ? new Date(expectedDate) : null) : existing.expectedDate,
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
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    })

    // Update line items if provided
    if (lineItems && Array.isArray(lineItems)) {
      // Delete existing line items
      await prisma.purchaseOrderLineItem.deleteMany({
        where: { poId: params.id },
      })

      // Create new line items
      for (const item of lineItems) {
        await prisma.purchaseOrderLineItem.create({
          data: {
            poId: params.id,
            description: item.description || '',
            quantity: parseFloat(item.quantity) || 1,
            unitPrice: parseFloat(item.unitPrice) || 0,
            total: parseFloat(item.quantity) * parseFloat(item.unitPrice),
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
        description: `Purchase order ${purchaseOrder.poNumber} updated`,
      },
    })

    // Calculate totals for response
    const responseSubtotal = purchaseOrder.lineItems.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.unitPrice))
    }, 0)
    const taxAmount = parseFloat(tax || 0)
    const shippingAmount = parseFloat(shipping || 0)

    return NextResponse.json({
      purchaseOrder: {
        ...purchaseOrder,
        subtotal: responseSubtotal,
        tax: taxAmount,
        shipping: shippingAmount,
      },
    })
  } catch (error) {
    console.error('Update purchase order error:', error)
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
    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!purchaseOrder) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    // Don't delete if there are receipts
    // Note: Receipt tracking would require a separate PurchaseOrderReceipt model
    const receiptCount = 0

    if (receiptCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete purchase order with receipts' },
        { status: 400 }
      )
    }

    await prisma.purchaseOrder.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ message: 'Purchase order deleted successfully' })
  } catch (error) {
    console.error('Delete purchase order error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
