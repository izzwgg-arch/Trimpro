import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireAnyPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/items/picker
 * Returns items and bundles formatted for FastPicker component
 * Used by Estimates, Invoices, Purchase Orders for line item selection
 */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireAnyPermission(request, [
    'settings.view',
    'estimates.view',
    'invoices.view',
    'purchase_orders.view',
    'jobs.view',
  ])
  if (permError) return permError

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
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Fetch all items first, then split by kind.
    // This is resilient to legacy rows where kind may be null/unknown:
    // anything not explicitly BUNDLE is treated as a regular selectable item.
    const allItems = await prisma.item.findMany({
      where,
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
          },
        },
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
      take: 1000, // Reasonable limit for picker
    })

    const items = allItems.filter((item) => item.kind !== 'BUNDLE')
    const bundleItems = allItems.filter((item) => item.kind === 'BUNDLE')

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
      description: item.description,
      notes: item.notes,
      tag: Array.isArray(item.tags) && item.tags.length > 0 ? item.tags.join(', ') : null,
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
      description: item.description,
      notes: item.notes,
      bundleId: item.bundleDefinition?.id || null, // BundleDefinition ID (for API calls)
      tag: Array.isArray(item.tags) && item.tags.length > 0 ? item.tags.join(', ') : null,
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
