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
    const job = await prisma.job.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        client: {
          include: {
            contacts: {
              where: { isPrimary: true },
              take: 1,
            },
          },
        },
        addresses: true,
        estimate: {
          include: {
            lineItems: true,
          },
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
          include: {
            lineItems: true,
          },
        },
        purchaseOrders: {
          orderBy: { createdAt: 'desc' },
          include: {
            lineItems: true,
          },
        },
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        tasks: {
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
        notes: {
          orderBy: { createdAt: 'desc' },
        },
        attachments: {
          orderBy: { createdAt: 'desc' },
        },
        schedules: {
          orderBy: { startTime: 'asc' },
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
        _count: {
          select: {
            tasks: true,
            issues: true,
            invoices: true,
          },
        },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Find job site address
    const addresses = job.addresses || []
    const jobSite = addresses.find(addr => addr.type === 'job_site') || null

    // Ensure arrays are initialized
    const safeJob = {
      ...job,
      addresses: addresses,
      assignments: job.assignments || [],
      tasks: job.tasks || [],
      issues: job.issues || [],
      invoices: job.invoices || [],
      notes: job.notes || [],
      schedules: job.schedules || [],
      client: {
        ...job.client,
        contacts: job.client.contacts || [],
      },
    }

    // Transform job to match frontend expectations
    const jobResponse = {
      ...safeJob,
      jobSite: jobSite ? {
        id: jobSite.id,
        street: jobSite.street,
        city: jobSite.city,
        state: jobSite.state,
        zipCode: jobSite.zipCode,
        country: jobSite.country,
      } : null,
      estimateAmount: job.estimateAmount ? job.estimateAmount.toString() : null,
      actualAmount: job.actualAmount ? job.actualAmount.toString() : null,
      laborCost: job.laborCost ? job.laborCost.toString() : null,
      materialCost: job.materialCost ? job.materialCost.toString() : null,
      invoices: safeJob.invoices.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        total: inv.total.toString(),
        balance: inv.balance.toString(),
        status: inv.status,
      })),
    }

    return NextResponse.json({ job: jobResponse })
  } catch (error) {
    console.error('Get job error:', error)
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
      title,
      description,
      status,
      priority,
      scheduledStart,
      scheduledEnd,
      actualStart,
      actualEnd,
      estimateAmount,
      actualAmount,
      laborCost,
      materialCost,
    } = body

    // Get existing job
    const existing = await prisma.job.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Track status change for activity
    const statusChanged = status && status !== existing.status

    // Update job
    const job = await prisma.job.update({
      where: { id: params.id },
      data: {
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
        status: status !== undefined ? status : existing.status,
        priority: priority !== undefined ? priority : existing.priority,
        scheduledStart: scheduledStart !== undefined ? (scheduledStart ? new Date(scheduledStart) : null) : existing.scheduledStart,
        scheduledEnd: scheduledEnd !== undefined ? (scheduledEnd ? new Date(scheduledEnd) : null) : existing.scheduledEnd,
        actualStart: actualStart !== undefined ? (actualStart ? new Date(actualStart) : null) : existing.actualStart,
        actualEnd: actualEnd !== undefined ? (actualEnd ? new Date(actualEnd) : null) : existing.actualEnd,
        estimateAmount: estimateAmount !== undefined ? parseFloat(estimateAmount) : existing.estimateAmount,
        actualAmount: actualAmount !== undefined ? parseFloat(actualAmount) : existing.actualAmount,
        laborCost: laborCost !== undefined ? parseFloat(laborCost) : existing.laborCost,
        materialCost: materialCost !== undefined ? parseFloat(materialCost) : existing.materialCost,
      },
    })

    // Create activity if status changed
    if (statusChanged) {
      await prisma.activity.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: 'JOB_STATUS_CHANGED',
          description: `Job "${job.title}" status changed from ${existing.status} to ${job.status}`,
          jobId: job.id,
          clientId: job.clientId,
        },
      })
    }

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'UPDATE',
        entityType: 'Job',
        entityId: job.id,
        changes: {
          before: {
            status: existing.status,
            title: existing.title,
          },
          after: {
            status: job.status,
            title: job.title,
          },
        },
      },
    })

    return NextResponse.json({ job })
  } catch (error) {
    console.error('Update job error:', error)
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
    const job = await prisma.job.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Don't delete if job has invoices
    const hasInvoices = await prisma.invoice.count({
      where: { jobId: params.id },
    })

    if (hasInvoices > 0) {
      return NextResponse.json(
        { error: 'Cannot delete job with invoices. Cancel it instead.' },
        { status: 400 }
      )
    }

    // Delete related data first (cascade should handle most, but being explicit for safety)
    await prisma.jobAssignment.deleteMany({
      where: { jobId: params.id },
    })

    await prisma.address.deleteMany({
      where: { jobId: params.id },
    })

    // Actually delete the job
    await prisma.job.delete({
      where: { id: params.id },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'DELETE',
        entityType: 'Job',
        entityId: job.id,
      },
    })

    return NextResponse.json({ message: 'Job deleted successfully' })
  } catch (error) {
    console.error('Delete job error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
