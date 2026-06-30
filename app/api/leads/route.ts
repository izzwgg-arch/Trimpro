import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { notifyRequestCreated } from '@/lib/notifications'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'leads.view')
  if (permError) return permError

  const user = getAuthUser(request)
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const source = searchParams.get('source') || 'all'
  const assignedToId = searchParams.get('assignedToId') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const skip = (page - 1) * limit
  const sortByRaw = searchParams.get('sortBy') || 'updatedAt'
  const sortDirectionRaw = searchParams.get('sortDirection') || 'desc'
  const sortDirection = sortDirectionRaw === 'asc' ? 'asc' : 'desc'
  const sortMap: Record<string, any> = {
    name: [{ firstName: sortDirection }, { lastName: sortDirection }],
    status: { status: sortDirection },
    source: { source: sortDirection },
    assigned: { assignedTo: { firstName: sortDirection } },
    probability: { probability: sortDirection },
    createdAt: { createdAt: sortDirection },
    updatedAt: { updatedAt: sortDirection },
  }
  const orderBy = sortMap[sortByRaw] || sortMap.updatedAt

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { jobSiteAddress: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { client: { companyName: { contains: search, mode: 'insensitive' } } },
        { client: { addresses: { some: { street: { contains: search, mode: 'insensitive' } } } } },
        { client: { addresses: { some: { city: { contains: search, mode: 'insensitive' } } } } },
        { client: { addresses: { some: { state: { contains: search, mode: 'insensitive' } } } } },
        { client: { addresses: { some: { zipCode: { contains: search, mode: 'insensitive' } } } } },
      ]
    }

    if (status !== 'all') {
      where.status = status
    }

    if (source !== 'all') {
      where.source = source
    }

    if (assignedToId) {
      where.assignedToId = assignedToId
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: {
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          client: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              estimates: true,
              calls: true,
              smsMessages: true,
              emails: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.lead.count({ where }),
    ])

    return NextResponse.json({
      leads,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Get leads error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'leads.create')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const {
      firstName,
      lastName,
      email,
      phone,
      company,
      clientId,
      jobSiteAddress,
      source,
      status,
      value,
      probability,
      notes,
      assignedToId,
    } = body

    if (!firstName || !lastName) {
      return NextResponse.json({ error: 'First name and last name are required' }, { status: 400 })
    }

    // Verify assignee if provided
    if (assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: assignedToId,
          tenantId: user.tenantId,
        },
      })

      if (!assignee) {
        return NextResponse.json({ error: 'Assignee not found' }, { status: 404 })
      }
    }

    // Client selection rules (matches UI):
    // - Existing Client: clientId is provided -> do NOT create/sync a QBO customer here.
    // - New Client: clientId is null/empty -> create a new TrimPro client (and sync to QBO).
    let resolvedClientId: string | null = null
    let createdClientIdForSync: string | null = null
    if (clientId) {
      const client = await prisma.client.findFirst({
        where: {
          id: clientId,
          tenantId: user.tenantId,
        },
        select: { id: true },
      })
      if (!client) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }
      resolvedClientId = client.id
    } else {
      // "New Client" path
      const fullName = `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.trim()
      const createdClient = await prisma.client.create({
        data: {
          tenantId: user.tenantId,
          name: fullName,
          companyName: company || null,
          email: email || null,
          phone: phone || null,
          notes: notes || null,
          isActive: true,
        },
        select: { id: true },
      })
      resolvedClientId = createdClient.id
      createdClientIdForSync = createdClient.id
    }

    // Create lead
    const lead = await prisma.lead.create({
      data: {
        tenantId: user.tenantId,
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        company: company || null,
        convertedToClientId: resolvedClientId,
        jobSiteAddress: jobSiteAddress || null,
        source: source || 'OTHER',
        status: status || 'NEW',
        value: value ? parseFloat(value) : null,
        probability: probability || 50,
        notes: notes || null,
        assignedToId: assignedToId || null,
        createdByUserId: user.id,
      },
      include: {
        assignedTo: true,
      },
    })

    // Sync QBO customer ONLY when this request created a new client.
    if (createdClientIdForSync) {
      try {
        await enqueueQboSync(user.tenantId, 'client', createdClientIdForSync)
      } catch (error) {
        console.error('QuickBooks client sync trigger error (new client from request):', error)
      }
    }

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'OTHER',
        description: `Request "${firstName} ${lastName}" created`,
        leadId: lead.id,
      },
    })

    // Notify only the intended request recipients about a new request
    await notifyRequestCreated(user.tenantId, lead.id, `${firstName} ${lastName}`)

    // Create notification for assignee if different from creator
    if (assignedToId && assignedToId !== user.id) {
      await prisma.notification.create({
        data: {
          tenantId: user.tenantId,
          userId: assignedToId,
          type: 'OTHER',
          title: 'New Request Assigned',
          message: `${user.firstName} ${user.lastName} assigned you a new request: "${firstName} ${lastName}"`,
          linkType: 'request',
          linkId: lead.id,
          linkUrl: `/dashboard/requests/${lead.id}`,
        },
      })
    }

    return NextResponse.json({ lead }, { status: 201 })
  } catch (error) {
    console.error('Create lead error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
