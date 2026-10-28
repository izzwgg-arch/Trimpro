import { prisma } from '@/lib/prisma'
import { createNotificationsForUsers } from '@/lib/notifications'
import { copyRequestAttachmentsToJob } from '@/lib/jobs/copy-request-attachments-to-job'
import { syncJobCostFromLinkedDocuments } from '@/lib/jobs/sync-job-cost'

/**
 * An estimate that came from a request and has no job yet: its invoices wait for
 * someone to pick a new job or an existing one, instead of getting a job automatically.
 */
export function estimateWaitsForJobChoice(estimate: { leadId?: string | null; jobId?: string | null } | null | undefined) {
  return Boolean(estimate?.leadId && !estimate?.jobId)
}

export const CHOOSE_JOB_ACTION = 'choose_job'
export const CHOOSE_JOB_TITLE = 'New invoice approved — choose a job'

/**
 * Alert the person who made the estimate (or the office managers when nobody is on
 * record) that an invoice from it needs a job.
 */
export async function notifyInvoiceNeedsJob(params: {
  tenantId: string
  estimate: { id: string; estimateNumber: string; createdById?: string | null }
  invoice: { id: string; invoiceNumber: string }
  clientName: string
  approvedBy?: string | null
}): Promise<string[]> {
  let recipients: string[] = []
  if (params.estimate.createdById) {
    const creator = await prisma.user.findFirst({
      where: { id: params.estimate.createdById, tenantId: params.tenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (creator) recipients = [creator.id]
  }
  if (recipients.length === 0) {
    const managers = await prisma.user.findMany({
      where: { tenantId: params.tenantId, role: { in: ['ADMIN', 'MANAGER'] }, status: 'ACTIVE' },
      select: { id: true },
    })
    recipients = managers.map((u) => u.id)
  }
  if (recipients.length === 0) return []

  const who = params.approvedBy ? `${params.approvedBy} approved` : 'The customer approved'
  await createNotificationsForUsers(params.tenantId, recipients, {
    type: 'SYSTEM',
    title: CHOOSE_JOB_TITLE,
    message: `${who} estimate ${params.estimate.estimateNumber} (${params.clientName}). Invoice ${params.invoice.invoiceNumber} was created. Please select whether to create a new job or put it on an existing job.`,
    linkUrl: `/dashboard/invoices/${params.invoice.id}?chooseJob=1`,
    linkType: 'invoice',
    linkId: params.invoice.id,
    action: CHOOSE_JOB_ACTION,
    requiresAck: true,
  })
  return recipients
}

/**
 * Put an invoice on an existing job. The invoice's estimate (and the estimate's other
 * invoices that have no job) go on the same job, and the request is marked converted.
 */
export async function linkInvoiceToExistingJob(params: {
  tenantId: string
  invoiceId: string
  jobId: string
  userId?: string | null
}) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    select: {
      id: true,
      invoiceNumber: true,
      clientId: true,
      estimateId: true,
      estimate: { select: { id: true, jobId: true, leadId: true } },
    },
  })
  if (!invoice) throw new JobChoiceError('Invoice not found', 404)
  const job = await prisma.job.findFirst({
    where: { id: params.jobId, tenantId: params.tenantId },
    select: { id: true, jobNumber: true, title: true, clientId: true },
  })
  if (!job) throw new JobChoiceError('Job not found', 404)
  if (invoice.clientId && job.clientId && invoice.clientId !== job.clientId) {
    throw new JobChoiceError('That job belongs to a different customer.', 400)
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: invoice.id }, data: { jobId: job.id } })
    if (invoice.estimate) {
      if (!invoice.estimate.jobId) {
        await tx.estimate.update({ where: { id: invoice.estimate.id }, data: { jobId: job.id } })
      }
      await tx.invoice.updateMany({
        where: { tenantId: params.tenantId, estimateId: invoice.estimate.id, jobId: null },
        data: { jobId: job.id },
      })
      if (invoice.estimate.leadId) {
        await tx.lead.updateMany({
          where: { id: invoice.estimate.leadId, tenantId: params.tenantId },
          data: { status: 'CONVERTED' },
        })
        await copyRequestAttachmentsToJob(tx, { leadId: invoice.estimate.leadId, jobId: job.id })
      }
    }
    await tx.activity.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId || null,
        type: 'OTHER',
        description: `Invoice ${invoice.invoiceNumber} added to existing job ${job.jobNumber}.`,
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        estimateId: invoice.estimateId,
        leadId: invoice.estimate?.leadId || null,
        jobId: job.id,
      },
    })
  })
  await syncJobCostFromLinkedDocuments(job.id)
  return { id: job.id, jobNumber: job.jobNumber, title: job.title }
}

/** After a job was made for one invoice, put the estimate's other job-less invoices on it too. */
export async function linkSiblingInvoicesToJob(params: { tenantId: string; estimateId: string | null; jobId: string }) {
  if (!params.estimateId) return
  await prisma.invoice.updateMany({
    where: { tenantId: params.tenantId, estimateId: params.estimateId, jobId: null },
    data: { jobId: params.jobId },
  })
}

/** The "choose a job" alerts for this invoice are done once a job is picked. */
export async function clearChooseJobAlerts(tenantId: string, invoiceId: string) {
  await prisma.notification.updateMany({
    where: { tenantId, linkType: 'invoice', linkId: invoiceId, title: CHOOSE_JOB_TITLE, status: 'UNREAD' },
    data: { status: 'READ', readAt: new Date(), acknowledgedAt: new Date() },
  })
}

export class JobChoiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}
