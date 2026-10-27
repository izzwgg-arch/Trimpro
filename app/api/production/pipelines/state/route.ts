import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import {
  allowedManualChanges,
  deriveEstimateStage,
  deriveInvoiceStage,
  type PipelineRecordType,
} from '@/lib/production/pipelines'

const TEXT_MAX = 500

/**
 * Update the pipeline-only details of one estimate or invoice: hold (with a
 * required reason), responsible person, next action, follow-up date, notes,
 * the draft review step, and the invoice "disputed" flag. Never writes the
 * estimate's or invoice's own status, totals or payments.
 *
 *   PUT /api/production/pipelines/state
 *   { recordType: 'ESTIMATE' | 'INVOICE', recordId, onHold?, holdReason?, reviewStage?,
 *     disputed?, responsibleUserId?, nextAction?, followUpDate?: 'YYYY-MM-DD' | null, notes? }
 */
export async function PUT(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const recordType: PipelineRecordType | null =
    body?.recordType === 'ESTIMATE' || body?.recordType === 'INVOICE' ? body.recordType : null
  const recordId = typeof body?.recordId === 'string' ? body.recordId : ''
  if (!recordType || !recordId) return NextResponse.json({ error: 'recordType and recordId are required' }, { status: 400 })

  // Same permission that editing the record itself needs.
  const permError = await requirePermission(request, recordType === 'ESTIMATE' ? 'estimates.edit' : 'invoices.edit')
  if (permError) return permError

  try {
    const existing = await prisma.pipelineRecordState.findUnique({
      where: { tenantId_recordType_recordId: { tenantId: user.tenantId, recordType, recordId } },
    })

    // Load the real record to know what may change right now.
    let status = ''
    let closed = false
    let label = ''
    if (recordType === 'ESTIMATE') {
      const est = await prisma.estimate.findFirst({
        where: { id: recordId, tenantId: user.tenantId },
        select: { id: true, estimateNumber: true, status: true, createdAt: true, updatedAt: true, sentAt: true, viewedAt: true, acceptedAt: true, clientId: true },
      })
      if (!est) return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
      status = est.status
      closed = deriveEstimateStage(est, null).closed
      label = est.estimateNumber
    } else {
      const inv = await prisma.invoice.findFirst({
        where: { id: recordId, tenantId: user.tenantId },
        select: { id: true, invoiceNumber: true, status: true, total: true, paidAmount: true, balance: true, dueDate: true, createdAt: true, updatedAt: true, clientId: true },
      })
      if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
      status = inv.status
      closed = deriveInvoiceStage(inv, null).closed
      label = inv.invoiceNumber
    }
    const allowed = allowedManualChanges(recordType, status, closed)

    const data: any = { updatedById: user.id }
    const log: string[] = []
    const now = new Date()

    if (body.onHold !== undefined) {
      const onHold = body.onHold === true
      if (onHold) {
        if (!allowed.hold) return NextResponse.json({ error: 'A finished record can not be put on hold.' }, { status: 400 })
        const reason = String(body.holdReason || '').trim().slice(0, 200)
        if (!reason) return NextResponse.json({ error: 'A hold reason is required.' }, { status: 400 })
        data.onHold = true
        data.holdReason = reason
        if (!existing?.onHold) {
          data.heldAt = now
          data.heldById = user.id
          data.releasedAt = null
          log.push(`put on hold: ${reason}`)
        } else if (existing.holdReason !== reason) {
          log.push(`hold reason changed: ${reason}`)
        }
      } else if (existing?.onHold) {
        data.onHold = false
        data.releasedAt = now
        log.push('released from hold')
      }
    }

    if (body.reviewStage !== undefined) {
      const review = body.reviewStage === 'INTERNAL_REVIEW' || body.reviewStage === 'READY_TO_SEND' ? body.reviewStage : null
      if (review && !allowed.review) {
        return NextResponse.json({ error: 'Review steps only apply while the record is a draft.' }, { status: 400 })
      }
      if ((existing?.reviewStage || null) !== review) {
        data.reviewStage = review
        data.reviewStageAt = review ? now : null
        log.push(review ? `moved to ${review === 'INTERNAL_REVIEW' ? 'Internal Review' : 'Ready to Send'}` : 'moved back to Draft')
      }
    }

    if (body.disputed !== undefined) {
      const disputed = body.disputed === true
      if (disputed && !allowed.dispute) {
        return NextResponse.json({ error: 'Only a sent, unpaid invoice can be marked disputed.' }, { status: 400 })
      }
      if (!!existing?.disputed !== disputed) {
        data.disputed = disputed
        data.disputedAt = disputed ? now : null
        log.push(disputed ? 'marked disputed' : 'dispute resolved')
      }
    }

    if (body.responsibleUserId !== undefined) {
      const id = body.responsibleUserId ? String(body.responsibleUserId) : null
      if (id) {
        const person = await prisma.user.findFirst({ where: { id, tenantId: user.tenantId }, select: { id: true, firstName: true, lastName: true } })
        if (!person) return NextResponse.json({ error: 'That person was not found.' }, { status: 400 })
        if (existing?.responsibleUserId !== id) log.push(`responsible: ${`${person.firstName} ${person.lastName}`.trim()}`)
      }
      data.responsibleUserId = id
    }

    if (body.nextAction !== undefined) {
      const next = String(body.nextAction || '').trim().slice(0, TEXT_MAX) || null
      if ((existing?.nextAction || null) !== next && next) log.push(`next action: ${next}`)
      data.nextAction = next
    }

    if (body.followUpDate !== undefined) {
      if (body.followUpDate === null || body.followUpDate === '') {
        data.followUpDate = null
      } else if (typeof body.followUpDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.followUpDate)) {
        // Midday so the date never shifts across time zones.
        data.followUpDate = new Date(`${body.followUpDate}T12:00:00.000Z`)
      } else {
        return NextResponse.json({ error: 'Follow-up date must be YYYY-MM-DD.' }, { status: 400 })
      }
    }

    if (body.notes !== undefined) {
      data.notes = String(body.notes || '').trim().slice(0, 4000) || null
    }

    const state = await prisma.pipelineRecordState.upsert({
      where: { tenantId_recordType_recordId: { tenantId: user.tenantId, recordType, recordId } },
      create: { tenantId: user.tenantId, recordType, recordId, ...data },
      update: data,
    })

    if (log.length) {
      await prisma.activity
        .create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            type: 'OTHER',
            description: `Pipeline (${label}): ${log.join('; ')}`,
            ...(recordType === 'ESTIMATE' ? { estimateId: recordId } : { invoiceId: recordId }),
          },
        })
        .catch((e) => console.error('pipeline activity log failed', e))
    }

    return NextResponse.json({ state })
  } catch (error) {
    console.error('Update pipeline state error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
