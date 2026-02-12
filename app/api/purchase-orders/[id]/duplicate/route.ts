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
    const source = await prisma.purchaseOrder.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        lineItems: {
          include: {
            group: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!source) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    const lastPO = await prisma.purchaseOrder.findFirst({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      select: { poNumber: true },
    })
    const nextNumber = lastPO
      ? parseInt(lastPO.poNumber.replace('PO-', ''), 10) + 1
      : 1
    const poNumber = `PO-${nextNumber.toString().padStart(6, '0')}`

    const duplicate = await prisma.purchaseOrder.create({
      data: {
        tenantId: user.tenantId,
        clientId: source.clientId,
        jobId: source.jobId,
        poNumber,
        vendor: source.vendor,
        vendorId: source.vendorId,
        status: 'DRAFT',
        total: source.total,
        orderDate: new Date(),
        expectedDate: source.expectedDate,
      },
    })

    const uniqueGroups = new Map<string, { name: string; sourceBundleId: string | null; sourceBundleName: string | null }>()
    for (const item of source.lineItems) {
      if (item.groupId && item.group) {
        uniqueGroups.set(item.groupId, {
          name: item.group.name,
          sourceBundleId: item.group.sourceBundleId,
          sourceBundleName: item.group.sourceBundleName,
        })
      }
    }

    const groupMap = new Map<string, string>()
    for (const [oldGroupId, group] of uniqueGroups.entries()) {
      const createdGroup = await prisma.documentLineGroup.create({
        data: {
          tenantId: user.tenantId,
          documentType: 'PURCHASE_ORDER',
          documentId: duplicate.id,
          name: group.name,
          sourceBundleId: group.sourceBundleId,
          sourceBundleName: group.sourceBundleName,
        },
      })
      groupMap.set(oldGroupId, createdGroup.id)
    }

    if (source.lineItems.length > 0) {
      await prisma.purchaseOrderLineItem.createMany({
        data: source.lineItems.map((item) => ({
          poId: duplicate.id,
          groupId: item.groupId ? groupMap.get(item.groupId) || null : null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: item.unitCost,
          total: item.total,
          sortOrder: item.sortOrder,
          notes: item.notes,
          vendorId: item.vendorId,
          taxable: item.taxable,
          taxRate: item.taxRate,
          sourceItemId: item.sourceItemId,
          sourceBundleId: item.sourceBundleId,
        })),
      })
    }

    return NextResponse.json({ purchaseOrder: duplicate, id: duplicate.id }, { status: 201 })
  } catch (error) {
    console.error('Duplicate purchase order error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
