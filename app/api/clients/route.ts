import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getPaginationParams, createPaginationResponse } from '@/lib/pagination'
import { validateRequest, createClientSchema } from '@/lib/validation'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const { skip, take, page, limit } = getPaginationParams(searchParams)

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status !== 'all') {
      where.isActive = status === 'active'
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: {
          contacts: {
            where: { isPrimary: true },
            take: 1,
          },
          _count: {
            select: {
              jobs: true,
              invoices: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        skip,
        take,
      }),
      prisma.client.count({ where }),
    ])

    return NextResponse.json({
      clients,
      pagination: createPaginationResponse(total, limit, skip),
    })
  } catch (error) {
    console.error('Get clients error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  // Validate request body
  const validation = await validateRequest(request, createClientSchema)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  const { name, companyName, email, phone, website, notes, tags, billingAddress, shippingAddress } = validation.data

  try {

    // Create client
    const client = await prisma.client.create({
      data: {
        tenantId: user.tenantId,
        name,
        companyName: companyName || null,
        email: email || null,
        phone: phone || null,
        website: website || null,
        notes: notes || null,
        tags: tags || [],
        isActive: true,
      },
      include: {
        contacts: true,
        addresses: true,
      },
    })

    // Create billing address if provided
    if (billingAddress) {
      await prisma.address.create({
        data: {
          clientId: client.id,
          type: 'billing',
          street: billingAddress.street,
          city: billingAddress.city,
          state: billingAddress.state,
          zipCode: billingAddress.zipCode,
          country: billingAddress.country || 'US',
          isDefault: true,
        },
      })
    }

    // Create shipping address if provided
    if (shippingAddress) {
      await prisma.address.create({
        data: {
          clientId: client.id,
          type: 'shipping',
          street: shippingAddress.street,
          city: shippingAddress.city,
          state: shippingAddress.state,
          zipCode: shippingAddress.zipCode,
          country: shippingAddress.country || 'US',
        },
      })
    }

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'CLIENT_CREATED',
        description: `Client "${name}" created`,
        clientId: client.id,
      },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'CREATE',
        entityType: 'Client',
        entityId: client.id,
        changes: {
          name,
          email,
          phone,
        },
      },
    })

    return NextResponse.json({ client }, { status: 201 })
  } catch (error) {
    console.error('Create client error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
