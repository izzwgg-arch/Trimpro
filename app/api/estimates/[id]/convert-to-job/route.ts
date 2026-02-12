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
    const estimate = await prisma.estimate.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        lead: true,
        job: {
          select: { id: true, jobNumber: true, title: true },
        },
      },
    })

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    if (estimate.jobId && estimate.job) {
      return NextResponse.json({ job: estimate.job }, { status: 200 })
    }

    let clientId = estimate.clientId || null
    if (!clientId && estimate.lead?.convertedToClientId) {
      clientId = estimate.lead.convertedToClientId
    }

    if (!clientId && estimate.lead) {
      const createdClient = await prisma.client.create({
        data: {
          tenantId: user.tenantId,
          name: `${estimate.lead.firstName} ${estimate.lead.lastName}`.trim(),
          companyName: estimate.lead.company || null,
          email: estimate.lead.email || null,
          phone: estimate.lead.phone || null,
          notes: estimate.lead.notes || null,
          isActive: true,
        },
      })
      clientId = createdClient.id

      await prisma.lead.update({
        where: { id: estimate.lead.id },
        data: {
          convertedToClientId: createdClient.id,
          convertedAt: estimate.lead.convertedAt || new Date(),
          status: 'CONVERTED',
        },
      })
    }

    if (!clientId) {
      return NextResponse.json(
        { error: 'Estimate must be associated with a client or convertible request before creating a job.' },
        { status: 400 }
      )
    }

    const job = await prisma.$transaction(async (tx) => {
      const jobCount = await tx.job.count({
        where: { tenantId: user.tenantId },
      })
      const jobNumber = `JOB-${String(jobCount + 1).padStart(6, '0')}`

      const createdJob = await tx.job.create({
        data: {
          tenantId: user.tenantId,
          clientId,
          jobNumber,
          title: estimate.title,
          description: estimate.notes || null,
          status: 'QUOTE',
          priority: 3,
          estimateAmount: estimate.total,
        },
      })

      await tx.estimate.update({
        where: { id: estimate.id },
        data: {
          clientId,
          jobId: createdJob.id,
          status: 'CONVERTED',
        },
      })

      await tx.activity.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: 'JOB_CREATED',
          description: `Estimate "${estimate.estimateNumber}" converted to job ${jobNumber}`,
          clientId,
          estimateId: estimate.id,
          jobId: createdJob.id,
          leadId: estimate.leadId || undefined,
        },
      })

      return createdJob
    })

    return NextResponse.json({ job }, { status: 201 })
  } catch (error) {
    console.error('Convert estimate to job error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
