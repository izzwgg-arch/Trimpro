import { prisma } from '@/lib/prisma'
import { createNotificationsForUsers } from '@/lib/notifications'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import { ensureJobFromInvoice } from '@/lib/jobs/ensure-job-from-invoice'

/**
 * Run lifecycle side-effects after an invoice receives payment.
 * Creates/links a job and notifies staff when a new job is created.
 */
export async function afterInvoicePayment(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId },
    select: {
      id: true,
      tenantId: true,
      invoiceNumber: true,
      balance: true,
      paidAmount: true,
      client: { select: { name: true } },
    },
  })
  if (!invoice || Number(invoice.paidAmount || 0) <= 0) return

  const { job, created, skippedReason } = await ensureJobFromInvoice(invoiceId)

  if (!created || !job) {
    if (skippedReason === 'no_client') {
      console.error('[afterInvoicePayment] Job not created — no client resolvable', {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        tenantId: invoice.tenantId,
      })
    }
    return
  }

  const users = await prisma.user.findMany({
    where: {
      tenantId: invoice.tenantId,
      role: { in: ['ADMIN', 'ACCOUNTING', 'OFFICE', 'MANAGER'] },
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  if (users.length > 0) {
    const clientName = invoice.client?.name || 'Unknown Client'
    const jobTitle = job.title || `Job ${job.jobNumber || ''}`
    const newBalance = Number(invoice.balance || 0)
    const paymentStatus = newBalance <= 0 ? 'paid in full' : 'partially paid'
    try {
      await createNotificationsForUsers(
        invoice.tenantId,
        users.map((u) => u.id),
        {
          type: 'SYSTEM',
          title: 'Job Created From Paid Invoice',
          message: `Invoice #${invoice.invoiceNumber} (${clientName}) was ${paymentStatus}. Job "${jobTitle}" has been automatically created.`,
          linkUrl: `/dashboard/jobs/${job.id}`,
          linkType: 'job',
          linkId: job.id,
          requiresAck: true,
        }
      )
    } catch (error) {
      console.error('[afterInvoicePayment] Job created but notification failed:', {
        invoiceId: invoice.id,
        jobId: job.id,
        error,
      })
    }
  }

  try {
    await enqueueQboSync(invoice.tenantId, 'job', job.id, { processImmediately: false })
  } catch (error) {
    console.error('QuickBooks job/project sync trigger error (payment lifecycle):', error)
  }
}
