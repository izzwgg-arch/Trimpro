import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import { parseAddressParts } from '@/lib/address/parse'
import { geocodeAddressPartsFromString } from '@/lib/geocoding'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const lead = await prisma.lead.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        client: {
          select: {
            id: true,
            name: true,
            companyName: true,
          },
        },
        estimates: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        tasks: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        issues: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        calls: {
          orderBy: { startedAt: 'desc' },
          take: 20,
        },
        smsMessages: {
          orderBy: { sentAt: 'desc' },
          take: 20,
        },
        emails: {
          orderBy: { sentAt: 'desc' },
          take: 20,
        },
        schedules: {
          orderBy: { startTime: 'asc' },
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        _count: {
          select: {
            estimates: true,
            tasks: true,
            issues: true,
            calls: true,
            smsMessages: true,
            emails: true,
          },
        },
      },
    })

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const parsed = parseAddressParts(lead.jobSiteAddress)
    const missingParts =
      !!lead.jobSiteAddress &&
      (!parsed || !parsed.city || !parsed.state || !parsed.zipCode)

    // Leads only store a single jobSiteAddress string; attempt a best-effort geocode
    // to populate city/state/zip for display when the string is incomplete.
    const geo = missingParts ? await geocodeAddressPartsFromString(lead.jobSiteAddress!) : null

    const derived = {
      jobSiteCity: (parsed?.city || geo?.city || '').trim() || null,
      jobSiteState: (parsed?.state || geo?.state || '').trim() || null,
      jobSiteZipCode: (parsed?.zipCode || geo?.zipCode || '').trim() || null,
    }
    return NextResponse.json({
      lead: {
        ...lead,
        ...derived,
      },
    })
  } catch (error) {
    console.error('Get lead error:', error)
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

    // Get existing lead
    const existing = await prisma.lead.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // Verify assignee if changed
    if (assignedToId && assignedToId !== existing.assignedToId) {
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
      const linkedClient = await prisma.client.findFirst({
        where: {
          id: clientId,
          tenantId: user.tenantId,
        },
      })
      if (!linkedClient) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }
    }

    // Track status change
    const statusChanged = status && status !== existing.status
    const convertedToClient = status === 'CONVERTED' && existing.status !== 'CONVERTED'

    // Update lead
    const lead = await prisma.lead.update({
      where: { id: params.id },
      data: {
        firstName: firstName !== undefined ? firstName : existing.firstName,
        lastName: lastName !== undefined ? lastName : existing.lastName,
        email: email !== undefined ? email : existing.email,
        phone: phone !== undefined ? phone : existing.phone,
        company: company !== undefined ? company : existing.company,
        convertedToClientId:
          clientId !== undefined
            ? (clientId || null)
            : existing.convertedToClientId,
        jobSiteAddress:
          jobSiteAddress !== undefined
            ? (jobSiteAddress || null)
            : existing.jobSiteAddress,
        source: source !== undefined ? source : existing.source,
        status: status !== undefined ? status : existing.status,
        value: value !== undefined ? parseFloat(value) : existing.value,
        probability: probability !== undefined ? probability : existing.probability,
        notes: notes !== undefined ? notes : existing.notes,
        assignedToId: assignedToId !== undefined ? assignedToId : existing.assignedToId,
      },
      include: {
        assignedTo: true,
      },
    })

    // Handle conversion to client
    if (convertedToClient && !lead.convertedToClientId) {
      // Create client from lead
      const client = await prisma.client.create({
        data: {
          tenantId: user.tenantId,
          name: `${lead.firstName} ${lead.lastName}`,
          companyName: lead.company || null,
          email: lead.email || null,
          phone: lead.phone || null,
          notes: lead.notes || null,
          isActive: true,
        },
      })

      try {
        await enqueueQboSync(user.tenantId, 'client', client.id)
      } catch (error) {
        console.error('QuickBooks client sync trigger error (lead convert):', error)
      }

      // Update lead with client ID
      await prisma.lead.update({
        where: { id: params.id },
        data: {
          convertedToClientId: client.id,
          convertedAt: new Date(),
        },
      })

      lead.convertedToClientId = client.id
      lead.convertedAt = new Date()

      // Create activity
      await prisma.activity.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: 'CLIENT_CREATED',
          description: `Lead "${lead.firstName} ${lead.lastName}" converted to client`,
          clientId: client.id,
          leadId: lead.id,
        },
      })
    }

    // Create activity for status change
    if (statusChanged) {
      await prisma.activity.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: 'ISSUE_CREATED', // Placeholder
          description: `Lead "${lead.firstName} ${lead.lastName}" status changed to ${lead.status}`,
          leadId: lead.id,
        },
      })
    }

    return NextResponse.json({ lead })
  } catch (error) {
    console.error('Update lead error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const lead = await prisma.lead.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    await prisma.lead.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ message: 'Lead deleted successfully' })
  } catch (error) {
    console.error('Delete lead error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
