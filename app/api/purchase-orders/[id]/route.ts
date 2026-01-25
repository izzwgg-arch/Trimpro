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
    const total = subtotal
    const receivedTotal = 0 // Receipts tracking would require a separate model

    return NextResponse.json({
      purchaseOrder: {
        ...purchaseOrder,
        subtotal,
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
      jobId,
      status,
      expectedDate,
      lineItems,
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

    // Update purchase order
    const purchaseOrder = await prisma.purchaseOrder.update({
      where: { id: params.id },
      data: {
        vendor: vendor !== undefined ? vendor : existing.vendor,
        jobId: jobId !== undefined ? (jobId || null) : existing.jobId,
        status: status !== undefined ? status : existing.status,
        expectedDate: expectedDate !== undefined ? (expectedDate ? new Date(expectedDate) : null) : existing.expectedDate,
      },
      include: {
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

    // Note: Activity creation would require a valid ActivityType enum value

    return NextResponse.json({ purchaseOrder })
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
