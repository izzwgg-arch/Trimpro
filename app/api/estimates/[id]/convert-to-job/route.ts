import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

function normalizePhone(value: string | null | undefined) {
  return (value || '').replace(/\D/g, '')
}

function parseJobSiteAddress(address: string | null | undefined) {
  if (!address) return null
  const trimmed = address.trim()
  if (!trimmed) return null
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean)
  const street = parts[0] || trimmed
  const city = parts[1] || ''
  const stateZip = parts[2] || ''
  const stateZipMatch = stateZip.match(/^([A-Za-z]{2})\s+(.+)$/)
  const state = stateZipMatch ? stateZipMatch[1] : stateZip
  const zipCode = stateZipMatch ? stateZipMatch[2] : ''
  return {
    street,
    city,
    state,
    zipCode,
    country: 'US',
  }
}

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
      const fullName = `${estimate.lead.firstName} ${estimate.lead.lastName}`.trim()
      const normalizedEmail = (estimate.lead.email || '').trim().toLowerCase()
      const normalizedPhone = normalizePhone(estimate.lead.phone)
      const existingClient = await prisma.client.findFirst({
        where: {
          tenantId: user.tenantId,
          OR: [
            ...(normalizedEmail
              ? [{ email: { equals: normalizedEmail, mode: 'insensitive' as const } }]
              : []),
            ...(normalizedPhone ? [{ phone: { contains: normalizedPhone } }] : []),
            {
              AND: [
                { name: { equals: fullName, mode: 'insensitive' } },
                ...(estimate.lead.company
                  ? [{ companyName: { equals: estimate.lead.company, mode: 'insensitive' } }]
                  : []),
              ],
            },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      })

      if (existingClient) {
        clientId = existingClient.id
      } else {
        const createdClient = await prisma.client.create({
          data: {
            tenantId: user.tenantId,
            name: fullName,
            companyName: estimate.lead.company || null,
            email: estimate.lead.email || null,
            phone: estimate.lead.phone || null,
            notes: estimate.lead.notes || null,
            isActive: true,
          },
        })
        clientId = createdClient.id
      }

      await prisma.lead.update({
        where: { id: estimate.lead.id },
        data: {
          convertedToClientId: clientId,
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

      const parsedAddress = parseJobSiteAddress(estimate.jobSiteAddress)
      if (parsedAddress) {
        await tx.address.create({
          data: {
            jobId: createdJob.id,
            type: 'job_site',
            street: parsedAddress.street,
            city: parsedAddress.city,
            state: parsedAddress.state,
            zipCode: parsedAddress.zipCode,
            country: parsedAddress.country,
          },
        })
      }

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
