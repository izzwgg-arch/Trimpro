import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const type = searchParams.get('type') || 'all'
  const kind = searchParams.get('kind') || 'all' // 'all' | 'SINGLE' | 'BUNDLE'
  const categoryId = searchParams.get('categoryId') || ''
  const vendorId = searchParams.get('vendorId') || ''
  const active = searchParams.get('active')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const skip = (page - 1) * limit

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (type !== 'all') {
      where.type = type
    }

    if (kind !== 'all') {
      where.kind = kind
    }

    if (categoryId) {
      where.categoryId = categoryId
    }

    if (vendorId) {
      where.vendorId = vendorId
    }

    if (active !== null && active !== undefined && active !== '') {
      where.isActive = active === 'true'
    }

    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where,
        include: {
          vendor: {
            select: {
              id: true,
              name: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
        skip,
        take: limit,
      }),
      prisma.item.count({ where }),
    ])

    return NextResponse.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error: any) {
    console.error('Get items error:', error)
    return NextResponse.json({ 
      error: error?.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const {
      name,
      sku,
      type,
      description,
      unit,
      defaultUnitCost,
      defaultUnitPrice,
      taxable,
      taxRate,
      isActive,
      vendorId,
      categoryId,
      tags,
      notes,
    } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Check for duplicate SKU if provided
    if (sku) {
      const existing = await prisma.item.findFirst({
        where: {
          tenantId: user.tenantId,
          sku,
        },
      })
      if (existing) {
        return NextResponse.json({ error: 'SKU already exists' }, { status: 400 })
      }
    }

    // Validate and convert data
    const itemData: any = {
      tenantId: user.tenantId,
      name: name.trim(),
      sku: sku && sku.trim() ? sku.trim() : null,
      type: type || 'PRODUCT',
      description: description && description.trim() ? description.trim() : null,
      unit: unit || 'ea',
      defaultUnitCost: defaultUnitCost && defaultUnitCost !== '' ? parseFloat(String(defaultUnitCost)) : null,
      defaultUnitPrice: defaultUnitPrice && defaultUnitPrice !== '' ? parseFloat(String(defaultUnitPrice)) : 0,
      taxable: taxable !== undefined ? Boolean(taxable) : true,
      taxRate: taxRate && taxRate !== '' ? parseFloat(String(taxRate)) : null,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      vendorId: vendorId && vendorId !== '' ? vendorId : null,
      categoryId: categoryId && categoryId !== '' ? categoryId : null,
      tags: tags && Array.isArray(tags) ? tags.filter(t => t && t.trim()) : [],
      notes: notes && notes.trim() ? notes.trim() : null,
    }

    // Ensure defaultUnitPrice is not null or 0 if not provided
    if (!itemData.defaultUnitPrice || itemData.defaultUnitPrice === 0) {
      itemData.defaultUnitPrice = 0
    }

    const item = await prisma.item.create({
      data: itemData,
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    // Create activity (non-blocking)
    try {
      await prisma.activity.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: 'OTHER',
          description: `Item "${name}" created`,
        },
      })
    } catch (activityError) {
      // Log but don't fail the request if activity creation fails
      console.error('Failed to create activity for item:', activityError)
    }

    return NextResponse.json({ item }, { status: 201 })
  } catch (error: any) {
    console.error('Create item error:', error)
    console.error('Error details:', JSON.stringify(error, null, 2))
    // Return more detailed error message
    const errorMessage = error?.message || 'Internal server error'
    // Check for Prisma errors
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'A record with this SKU already exists' }, { status: 400 })
    }
    if (error?.code === 'P2003') {
      return NextResponse.json({ error: 'Invalid vendor or category reference' }, { status: 400 })
    }
    return NextResponse.json({ 
      error: errorMessage,
      code: error?.code,
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    }, { status: 500 })
  }
}
