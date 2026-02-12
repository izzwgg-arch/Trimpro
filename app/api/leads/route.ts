import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { notifyNewLead } from '@/lib/notifications'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const source = searchParams.get('source') || 'all'
  const assignedToId = searchParams.get('assignedToId') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const skip = (page - 1) * limit

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
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
        orderBy: {
          updatedAt: 'desc',
        },
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

    if (clientId) {
      const client = await prisma.client.findFirst({
        where: {
          id: clientId,
          tenantId: user.tenantId,
        },
      })
      if (!client) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }
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
        convertedToClientId: clientId || null,
        jobSiteAddress: jobSiteAddress || null,
        source: source || 'OTHER',
        status: status || 'NEW',
        value: value ? parseFloat(value) : null,
        probability: probability || 50,
        notes: notes || null,
        assignedToId: assignedToId || null,
      },
      include: {
        assignedTo: true,
      },
    })

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'OTHER',
        description: `Lead "${firstName} ${lastName}" created`,
        leadId: lead.id,
      },
    })

    // Notify sales team about new lead
    await notifyNewLead(user.tenantId, lead.id, `${firstName} ${lastName}`)

    // Create notification for assignee if different from creator
    if (assignedToId && assignedToId !== user.id) {
      await prisma.notification.create({
        data: {
          tenantId: user.tenantId,
          userId: assignedToId,
          type: 'TASK_ASSIGNED',
          title: 'New Lead Assigned',
          message: `${user.firstName} ${user.lastName} assigned you a new lead: "${firstName} ${lastName}"`,
          linkType: 'lead',
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
