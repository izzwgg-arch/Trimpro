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
            addresses: {
              where: { type: 'billing' },
              take: 1,
            },
          },
        },
        lead: true,
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
        attachments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    // Convert Decimal fields to strings for frontend
    const estimateResponse = {
      ...estimate,
      subtotal: estimate.subtotal.toString(),
      taxRate: estimate.taxRate.toString(),
      taxAmount: estimate.taxAmount.toString(),
      discount: estimate.discount.toString(),
      total: estimate.total.toString(),
      lineItems: estimate.lineItems.map(item => ({
        ...item,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        total: item.total.toString(),
        groupId: item.groupId || null,
        group: item.group ? {
          id: item.group.id,
          name: item.group.name,
          sourceBundleId: item.group.sourceBundleId,
          sourceBundleName: item.group.sourceBundleName,
        } : null,
        sourceItemId: item.sourceItemId || null,
        sourceItem: item.sourceItem ? {
          id: item.sourceItem.id,
          name: item.sourceItem.name,
          kind: item.sourceItem.kind,
        } : null,
      })),
    }

    return NextResponse.json({ estimate: estimateResponse })
  } catch (error) {
    console.error('Get estimate error:', error)
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
      validUntil,
      notes,
      terms,
    } = body

    // Get existing estimate
    const existing = await prisma.estimate.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        lineItems: true,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
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
      await prisma.estimateLineItem.deleteMany({
        where: { estimateId: params.id },
      })

      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i]
        const qty = parseFloat(item.quantity || 0)
        const price = parseFloat(item.unitPrice || 0)
        const itemTotal = qty * price

        await prisma.estimateLineItem.create({
          data: {
            estimateId: params.id,
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

    // Update estimate
    const estimate = await prisma.estimate.update({
      where: { id: params.id },
      data: {
        title: title !== undefined ? title : existing.title,
        subtotal: subtotal,
        taxRate: taxRateNum,
        taxAmount: tax,
        discount: discountAmount,
        total: total,
        status: status !== undefined ? status : existing.status,
        validUntil: validUntil !== undefined ? (validUntil ? new Date(validUntil) : null) : existing.validUntil,
        notes: notes !== undefined ? notes : existing.notes,
        terms: terms !== undefined ? terms : existing.terms,
      },
      include: {
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    return NextResponse.json({ estimate })
  } catch (error) {
    console.error('Update estimate error:', error)
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
    const estimate = await prisma.estimate.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    // Don't delete if converted to job or accepted
    if (estimate.status === 'CONVERTED' || estimate.status === 'ACCEPTED') {
      return NextResponse.json(
        { error: 'Cannot delete converted or accepted estimate' },
        { status: 400 }
      )
    }

    await prisma.estimate.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ message: 'Estimate deleted successfully' })
  } catch (error) {
    console.error('Delete estimate error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
