import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { ensureJobFromInvoice } from '@/lib/jobs/ensure-job-from-invoice'
import {
  JobChoiceError,
  clearChooseJobAlerts,
  linkInvoiceToExistingJob,
  linkSiblingInvoicesToJob,
} from '@/lib/jobs/invoice-job-choice'

/**
 * Put an invoice that has no job on a job: `{ decision: 'new' }` makes one (same as the
 * automatic estimate→invoice job), `{ decision: 'existing', jobId }` uses an open job.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'invoices.edit')
  if (permError) return permError
  const user = getAuthUser(request)

  const body = await request.json().catch(() => ({}))
  const decision = body?.decision
  if (decision !== 'new' && decision !== 'existing') {
    return NextResponse.json({ error: 'Choose "new" or "existing".' }, { status: 400 })
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, tenantId: user.tenantId },
    select: { id: true, jobId: true, jobType: true, estimateId: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (invoice.jobId) {
    return NextResponse.json({ error: 'This invoice is already on a job.' }, { status: 409 })
  }

  try {
    let job: { id: string; jobNumber: string; title: string } | null = null
    if (decision === 'existing') {
      const jobId = typeof body.jobId === 'string' ? body.jobId : ''
      if (!jobId) return NextResponse.json({ error: 'Select a job.' }, { status: 400 })
      job = await linkInvoiceToExistingJob({ tenantId: user.tenantId, invoiceId: invoice.id, jobId, userId: user.id })
    } else {
      const ensured = await ensureJobFromInvoice(invoice.id, { jobType: invoice.jobType })
      job = ensured.job
      if (!job) return NextResponse.json({ error: 'Could not create a job for this invoice.' }, { status: 400 })
      await linkSiblingInvoicesToJob({ tenantId: user.tenantId, estimateId: invoice.estimateId, jobId: job.id })
    }
    await clearChooseJobAlerts(user.tenantId, invoice.id)
    return NextResponse.json({ job })
  } catch (error) {
    if (error instanceof JobChoiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Invoice job choice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
