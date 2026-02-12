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
          parent: {
            select: {
              id: true,
              name: true,
            },
          },
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

  const { name, parentId, companyName, email, phone, website, notes, tags, billingAddress, shippingAddress } = validation.data

  try {

    let resolvedParentId: string | null = null
    let inheritedBillingAddress: typeof billingAddress = null
    if (parentId) {
      const parent = await prisma.client.findFirst({
        where: {
          id: parentId,
          tenantId: user.tenantId,
        },
        include: {
          addresses: {
            where: { type: 'billing' },
            take: 1,
          },
        },
      })

      if (!parent) {
        return NextResponse.json({ error: 'Parent client not found' }, { status: 400 })
      }

      resolvedParentId = parent.id
      if (!billingAddress && parent.addresses[0]) {
        inheritedBillingAddress = {
          street: parent.addresses[0].street,
          city: parent.addresses[0].city,
          state: parent.addresses[0].state,
          zipCode: parent.addresses[0].zipCode,
          country: parent.addresses[0].country || 'US',
        }
      }
    }

    // Create client
    const client = await prisma.client.create({
      data: {
        tenantId: user.tenantId,
        parentId: resolvedParentId,
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

    // Create billing address if provided (or inherit from parent client)
    const finalBillingAddress = billingAddress || inheritedBillingAddress
    if (finalBillingAddress) {
      await prisma.address.create({
        data: {
          clientId: client.id,
          type: 'billing',
          street: finalBillingAddress.street,
          city: finalBillingAddress.city,
          state: finalBillingAddress.state,
          zipCode: finalBillingAddress.zipCode,
          country: finalBillingAddress.country || 'US',
          isDefault: true,
        },
      })
    }

    // Sub-clients use billing address only; skip shipping address when parent is set.
    if (!resolvedParentId && shippingAddress) {
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
