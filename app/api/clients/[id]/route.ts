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
    const client = await prisma.client.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        parent: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        subClients: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            companyName: true,
            email: true,
            phone: true,
            isActive: true,
            createdAt: true,
          },
        },
        contacts: {
          orderBy: [
            { isPrimary: 'desc' },
            { createdAt: 'asc' },
          ],
        },
        addresses: true,
        jobs: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            assignments: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
        invoices: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        estimates: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        calls: {
          take: 20,
          orderBy: { startedAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        smsMessages: {
          take: 20,
          orderBy: { sentAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        emails: {
          take: 20,
          orderBy: { sentAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        notes_history: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        tasks: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            assignee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        issues: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            assignee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        _count: {
          select: {
            jobs: true,
            invoices: true,
            estimates: true,
            calls: true,
            smsMessages: true,
            emails: true,
          },
        },
      },
    })

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Ensure all arrays are present (defensive)
    const safeClient = {
      ...client,
      contacts: client.contacts || [],
      addresses: client.addresses || [],
      jobs: client.jobs || [],
      invoices: client.invoices || [],
      estimates: client.estimates || [],
      calls: client.calls || [],
      smsMessages: client.smsMessages || [],
      emails: client.emails || [],
      notes: client.notes_history || [],
      tasks: client.tasks || [],
      issues: client.issues || [],
      parent: client.parent || null,
      subClients: client.subClients || [],
      _count: client._count || {
        jobs: 0,
        invoices: 0,
        estimates: 0,
        calls: 0,
        smsMessages: 0,
        emails: 0,
      },
    }

    return NextResponse.json({ client: safeClient })
  } catch (error) {
    console.error('Get client error:', error)
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
    const { name, companyName, email, phone, website, notes, tags, isActive, billingAddress, shippingAddress } = body

    // Get existing client
    const existing = await prisma.client.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        addresses: true,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Update client
    const client = await prisma.client.update({
      where: { id: params.id },
      data: {
        name: name !== undefined ? name : existing.name,
        companyName: companyName !== undefined ? companyName : existing.companyName,
        email: email !== undefined ? email : existing.email,
        phone: phone !== undefined ? phone : existing.phone,
        website: website !== undefined ? website : existing.website,
        notes: notes !== undefined ? notes : existing.notes,
        tags: tags !== undefined ? tags : existing.tags,
        isActive: isActive !== undefined ? isActive : existing.isActive,
      },
    })

    // Upsert billing/shipping addresses (match create-client behavior)
    const upsertAddress = async (type: 'billing' | 'shipping', addr: any) => {
      const existingAddr = (existing.addresses || []).find((a) => a.type === type)

      const isEmpty =
        !addr ||
        typeof addr !== 'object' ||
        typeof addr.street !== 'string' ||
        addr.street.trim() === ''

      if (isEmpty) {
        // If cleared, delete existing address of this type (if any)
        if (existingAddr) {
          await prisma.address.delete({ where: { id: existingAddr.id } })
        }
        return
      }

      const data = {
        clientId: client.id,
        type,
        street: String(addr.street || '').trim(),
        city: String(addr.city || '').trim(),
        state: String(addr.state || '').trim(),
        zipCode: String(addr.zipCode || '').trim(),
        country: String(addr.country || 'US').trim() || 'US',
        ...(type === 'billing' ? { isDefault: true } : {}),
      }

      if (existingAddr) {
        await prisma.address.update({
          where: { id: existingAddr.id },
          data,
        })
      } else {
        await prisma.address.create({ data })
      }
    }

    await upsertAddress('billing', billingAddress)
    await upsertAddress('shipping', shippingAddress)

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'UPDATE',
        entityType: 'Client',
        entityId: client.id,
        changes: {
          before: {
            name: existing.name,
            email: existing.email,
            phone: existing.phone,
          },
          after: {
            name: client.name,
            email: client.email,
            phone: client.phone,
          },
        },
      },
    })

    return NextResponse.json({ client })
  } catch (error) {
    console.error('Update client error:', error)
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
    const client = await prisma.client.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            jobs: true,
            invoices: true,
          },
        },
      },
    })

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Hard delete is blocked by DB constraints when jobs/invoices exist (onDelete: Restrict).
    if (client._count.jobs > 0 || client._count.invoices > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete client "${client.name}" because it has ${client._count.jobs} job(s) and ${client._count.invoices} invoice(s). Remove those records first.`,
        },
        { status: 400 }
      )
    }

    await prisma.client.delete({
      where: { id: params.id },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'DELETE',
        entityType: 'Client',
        entityId: client.id,
      },
    })

    return NextResponse.json({ message: 'Client deleted successfully' })
  } catch (error) {
    console.error('Delete client error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
