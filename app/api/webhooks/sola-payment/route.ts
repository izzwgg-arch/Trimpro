import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyInvoicePaid, createNotificationsForUsers } from '@/lib/notifications'

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

async function ensureJobFromEstimate(tenantId: string, estimateId: string): Promise<{
  job: { id: string; jobNumber: string; title: string } | null
  created: boolean
}> {
  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId },
    include: {
      lead: true,
      job: {
        select: { id: true, jobNumber: true, title: true },
      },
    },
  })

  if (!estimate) return { job: null, created: false }
  if (estimate.jobId && estimate.job) return { job: estimate.job, created: false }

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
        tenantId,
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
          tenantId,
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
  }

  if (!clientId) return { job: null, created: false }

  const createdJob = await prisma.$transaction(async (tx) => {
    const jobCount = await tx.job.count({ where: { tenantId } })
    const jobNumber = `JOB-${String(jobCount + 1).padStart(6, '0')}`
    const createdJob = await tx.job.create({
      data: {
        tenantId,
        clientId,
        jobNumber,
        title: estimate.title,
        description: estimate.notes || null,
        status: 'QUOTE',
        priority: 3,
        estimateAmount: estimate.total,
      },
      select: { id: true, jobNumber: true, title: true },
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
        tenantId,
        type: 'JOB_CREATED',
        description: `Payment received. Estimate "${estimate.estimateNumber}" converted to job ${createdJob.jobNumber}`,
        clientId,
        estimateId: estimate.id,
        jobId: createdJob.id,
      },
    })

    return createdJob
  })
  return { job: createdJob, created: true }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const resultCode = String(body?.Result || body?.result || body?.xResult || '')
    const paymentStatus = String(body?.status || '').toLowerCase()
    const isSuccess = resultCode.toUpperCase() === 'S' || paymentStatus === 'completed' || paymentStatus === 'paid'
    if (!isSuccess) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    const invoiceId = String(body?.invoiceId || body?.xInvoice || body?.InvoiceID || '')
    if (!invoiceId) {
      return NextResponse.json({ error: 'Missing invoice id' }, { status: 400 })
    }

    const paidAmount = Number(body?.amount || body?.xAmount || 0)
    const transactionId = String(body?.transactionId || body?.TransactionID || body?.xRefNum || '')

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId },
      include: {
        client: true,
        estimate: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const amount = paidAmount > 0 ? paidAmount : Number(invoice.balance)

    const existingPayment = transactionId
      ? await prisma.payment.findFirst({
          where: { solaTransactionId: transactionId },
        })
      : null

    let newPaidAmount = Number(invoice.paidAmount)
    let newBalance = Number(invoice.balance)

    if (!existingPayment) {
      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount,
          status: 'COMPLETED',
          method: 'CARD',
          reference: transactionId || null,
          solaTransactionId: transactionId || null,
          solaWebhookData: body,
          processedAt: new Date(),
        },
      })
      newPaidAmount = Number(invoice.paidAmount) + amount
      newBalance = Math.max(0, Number(invoice.total) - newPaidAmount)

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaidAmount,
          balance: newBalance,
          status: newBalance <= 0 ? 'PAID' : newPaidAmount > 0 ? 'PARTIAL' : invoice.status,
          paidAt: newBalance <= 0 ? new Date() : invoice.paidAt,
          solaTransactionId: transactionId || invoice.solaTransactionId,
        },
      })
    }

    if (!existingPayment) {
      await notifyInvoicePaid(
        invoice.tenantId,
        invoice.id,
        invoice.invoiceNumber,
        amount,
        invoice.client.name
      )
    }

    // Auto-create/link job as soon as any payment succeeds for an estimate-linked invoice.
    if (invoice.estimateId && newPaidAmount > 0) {
      const { job, created } = await ensureJobFromEstimate(invoice.tenantId, invoice.estimateId)
      if (!created) {
        return NextResponse.json({ ok: true })
      }
      const users = await prisma.user.findMany({
        where: {
          tenantId: invoice.tenantId,
          role: { in: ['ADMIN', 'ACCOUNTING'] },
          status: 'ACTIVE',
        },
        select: { id: true },
      })
      if (users.length > 0) {
        await createNotificationsForUsers(
          invoice.tenantId,
          users.map((u) => u.id),
          {
            type: 'SYSTEM',
            title: 'Payment received. Estimate is now a Job.',
            message: `Payment received. Estimate #${invoice.estimate?.estimateNumber || invoice.estimateId} is now a Job${job ? ` (${job.jobNumber})` : ''}.`,
            linkUrl: job ? `/dashboard/jobs/${job.id}` : `/dashboard/estimates/${invoice.estimateId}`,
            linkType: job ? 'job' : 'estimate',
            linkId: job ? job.id : invoice.estimateId,
            requiresAck: true,
          }
        )
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Sola payment webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

