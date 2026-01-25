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

    if (categoryId) {
      where.categoryId = categoryId
    }

    if (vendorId) {
      where.vendorId = vendorId
    }

    if (active !== null && active !== undefined) {
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

    const item = await prisma.item.create({
      data: {
        tenantId: user.tenantId,
        name,
        sku: sku || null,
        type: type || 'PRODUCT',
        description: description || null,
        unit: unit || 'ea',
        defaultUnitCost: defaultUnitCost ? parseFloat(defaultUnitCost) : null,
        defaultUnitPrice: parseFloat(defaultUnitPrice) || 0,
        taxable: taxable !== undefined ? taxable : true,
        taxRate: taxRate ? parseFloat(taxRate) : null,
        isActive: isActive !== undefined ? isActive : true,
        vendorId: vendorId || null,
        categoryId: categoryId || null,
        tags: tags && Array.isArray(tags) ? tags : [],
        notes: notes || null,
      },
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

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'OTHER',
        description: `Item "${name}" created`,
      },
    })

    return NextResponse.json({ item }, { status: 201 })
  } catch (error: any) {
    console.error('Create item error:', error)
    // Return more detailed error message
    const errorMessage = error?.message || 'Internal server error'
    return NextResponse.json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    }, { status: 500 })
  }
}
