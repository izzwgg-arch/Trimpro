import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    // Get lead
    const lead = await prisma.lead.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (lead.convertedToClientId) {
      return NextResponse.json(
        { error: 'Lead already converted to client' },
        { status: 400 }
      )
    }

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

    // Update lead
    const updatedLead = await prisma.lead.update({
      where: { id: params.id },
      data: {
        status: 'CONVERTED',
        convertedToClientId: client.id,
        convertedAt: new Date(),
      },
      include: {
        client: true,
      },
    })

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

    return NextResponse.json({
      lead: updatedLead,
      client,
      message: 'Lead converted to client successfully',
    })
  } catch (error) {
    console.error('Convert lead error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
