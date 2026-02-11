import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/items/picker
 * Returns items and bundles formatted for FastPicker component
 * Used by Estimates, Invoices, Purchase Orders for line item selection
 */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const activeOnly = searchParams.get('activeOnly') !== 'false' // Default true

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (activeOnly) {
      where.isActive = true
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Fetch items (SINGLE kind)
    const items = await prisma.item.findMany({
      where: {
        ...where,
        kind: 'SINGLE',
      },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
      take: 1000, // Reasonable limit for picker
    })

    // Fetch bundles (BUNDLE kind)
    const bundleItems = await prisma.item.findMany({
      where: {
        ...where,
        kind: 'BUNDLE',
      },
      include: {
        bundleDefinition: {
          include: {
            components: {
              include: {
                componentItem: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                componentBundle: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
              orderBy: {
                sortOrder: 'asc',
              },
            },
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
      take: 1000,
    })

    // Format items for FastPicker
    const formattedItems = items.map(item => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      kind: 'SINGLE' as const,
      defaultUnitPrice: Number(item.defaultUnitPrice),
      defaultUnitCost: item.defaultUnitCost ? Number(item.defaultUnitCost) : null,
      unit: item.unit,
      vendorId: item.vendorId,
      vendorName: item.vendor?.name || null,
      taxable: item.taxable,
      taxRate: item.taxRate ? Number(item.taxRate) : null,
      notes: item.notes,
    }))

    // Format bundles for FastPicker
    const formattedBundles = bundleItems.map(item => ({
      id: item.id, // Item ID
      name: item.name,
      sku: item.sku,
      kind: 'BUNDLE' as const,
      defaultUnitPrice: Number(item.defaultUnitPrice),
      defaultUnitCost: item.defaultUnitCost ? Number(item.defaultUnitCost) : null,
      unit: item.unit,
      vendorId: item.vendorId,
      vendorName: item.vendor?.name || null,
      taxable: item.taxable,
      taxRate: item.taxRate ? Number(item.taxRate) : null,
      notes: item.notes,
      bundleId: item.bundleDefinition?.id || null, // BundleDefinition ID (for API calls)
    }))

    return NextResponse.json({
      items: formattedItems,
      bundles: formattedBundles,
    })
  } catch (error: any) {
    console.error('Get items for picker error:', error)
    return NextResponse.json(
      {
        error: error?.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    )
  }
}
