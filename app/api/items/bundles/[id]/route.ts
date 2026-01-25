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
    const bundle = await prisma.bundleDefinition.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        item: true,
        components: {
          include: {
            componentItem: {
              select: {
                id: true,
                name: true,
                sku: true,
                defaultUnitPrice: true,
                defaultUnitCost: true,
                description: true,
                unit: true,
              },
            },
            componentBundle: {
              include: {
                item: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    })

    if (!bundle) {
      return NextResponse.json({ error: 'Bundle not found' }, { status: 404 })
    }

    return NextResponse.json({ bundle })
  } catch (error) {
    console.error('Get bundle error:', error)
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
      name,
      description,
      sku,
      type,
      categoryId,
      vendorId,
      tags,
      notes,
      pricingStrategy,
      components,
    } = body

    const existing = await prisma.bundleDefinition.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        item: true,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Bundle not found' }, { status: 404 })
    }

    // Update item
    await prisma.item.update({
      where: { id: existing.itemId },
      data: {
        name: name !== undefined ? name.trim() : existing.item.name,
        sku: sku !== undefined ? (sku && sku.trim() ? sku.trim() : null) : existing.item.sku,
        type: type !== undefined ? type : existing.item.type,
        description:
          description !== undefined
            ? (description && description.trim() ? description.trim() : null)
            : existing.item.description,
        vendorId: vendorId !== undefined ? (vendorId && vendorId !== '' ? vendorId : null) : existing.item.vendorId,
        categoryId:
          categoryId !== undefined
            ? (categoryId && categoryId !== '' ? categoryId : null)
            : existing.item.categoryId,
        tags: tags !== undefined ? (tags && Array.isArray(tags) ? tags.filter((t: string) => t && t.trim()) : []) : existing.item.tags,
        notes: notes !== undefined ? (notes && notes.trim() ? notes.trim() : null) : existing.item.notes,
      },
    })

    // Update bundle definition
    await prisma.bundleDefinition.update({
      where: { id: params.id },
      data: {
        name: name !== undefined ? name.trim() : existing.name,
        description:
          description !== undefined
            ? (description && description.trim() ? description.trim() : null)
            : existing.description,
        pricingStrategy: pricingStrategy !== undefined ? pricingStrategy : existing.pricingStrategy,
      },
    })

    // Update components if provided
    if (components && Array.isArray(components)) {
      // Delete existing components
      await prisma.bundleComponent.deleteMany({
        where: {
          bundleId: params.id,
        },
      })

      // Create new components
      for (let i = 0; i < components.length; i++) {
        const comp = components[i]

        // Check for circular reference
        if (comp.componentType === 'BUNDLE' && comp.componentBundleId === params.id) {
          return NextResponse.json(
            { error: 'Bundle cannot include itself' },
            { status: 400 }
          )
        }

        await prisma.bundleComponent.create({
          data: {
            bundleId: params.id,
            tenantId: user.tenantId,
            componentType: comp.componentType,
            componentItemId: comp.componentType === 'ITEM' ? comp.componentItemId : null,
            componentBundleId: comp.componentType === 'BUNDLE' ? comp.componentBundleId : null,
            quantity: parseFloat(comp.quantity) || 1,
            sortOrder: i,
            defaultUnitPriceOverride: comp.defaultUnitPriceOverride
              ? parseFloat(comp.defaultUnitPriceOverride)
              : null,
            defaultUnitCostOverride: comp.defaultUnitCostOverride
              ? parseFloat(comp.defaultUnitCostOverride)
              : null,
            notes: comp.notes && comp.notes.trim() ? comp.notes.trim() : null,
          },
        })
      }
    }

    const bundle = await prisma.bundleDefinition.findFirst({
      where: { id: params.id },
      include: {
        item: true,
        components: {
          include: {
            componentItem: {
              select: {
                id: true,
                name: true,
                sku: true,
                defaultUnitPrice: true,
                defaultUnitCost: true,
                description: true,
                unit: true,
              },
            },
            componentBundle: {
              include: {
                item: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    })

    return NextResponse.json({ bundle })
  } catch (error: any) {
    console.error('Update bundle error:', error)
    return NextResponse.json(
      {
        error: error?.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    )
  }
}
