/**
 * Recurring credit-card payments engine.
 *
 * On each due date the scheduler charges the customer's saved Cardknox card
 * (merchant-initiated) and records a real Payment through the existing payment
 * pipeline — invoice-linked schedules apply to that invoice; customer-level
 * schedules apply across the customer's open invoices oldest-first with any
 * leftover held as customer credit. Every attempt is logged as a
 * RecurringPaymentRun. This is staff-created and never exposed to customers.
 */
import { prisma } from '@/lib/prisma'
import { chargeSavedCard, cardknoxConfigured } from '@/lib/services/cardknox-gateway'
import { applyInvoicePayment } from '@/lib/payments/apply-payment'
import { afterInvoicePayment } from '@/lib/payments/after-invoice-payment'
import { createOverpaymentCredit } from '@/lib/payments/customer-credit'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import { sendPaymentReceiptForPayment } from '@/lib/payments/receipts'
import crypto from 'crypto'

const MAX_CONSECUTIVE_FAILURES = 3

function round2(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}

/** Advance a run date by the schedule frequency, preserving the day where possible. */
export function advanceNextRun(from: Date, frequency: string): Date {
  const d = new Date(from)
  switch (String(frequency).toUpperCase()) {
    case 'WEEKLY':
      d.setDate(d.getDate() + 7)
      return d
    case 'BIWEEKLY':
      d.setDate(d.getDate() + 14)
      return d
    case 'MONTHLY':
    default: {
      const day = d.getDate()
      d.setMonth(d.getMonth() + 1)
      // Guard month overflow (e.g. Jan 31 -> Mar 3): clamp to end of target month.
      if (d.getDate() < day) d.setDate(0)
      return d
    }
  }
}

export interface ProcessResult {
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  amount: number
  paymentIds: string[]
  refNum: string | null
  error?: string
}

/**
 * Process a single recurring payment that is due. Safe to call directly (manual
 * "charge now") or from the scheduler. Returns the outcome and records a run.
 */
export async function processRecurringPayment(recurringId: string): Promise<ProcessResult> {
  const rec = await prisma.recurringPayment.findUnique({
    where: { id: recurringId },
    include: {
      card: true,
      client: { select: { id: true, name: true, email: true, tenantId: true } },
    },
  })

  if (!rec) return { status: 'SKIPPED', amount: 0, paymentIds: [], refNum: null, error: 'not_found' }
  if (rec.status !== 'ACTIVE') {
    return { status: 'SKIPPED', amount: 0, paymentIds: [], refNum: null, error: `status_${rec.status}` }
  }
  if (!cardknoxConfigured()) {
    return { status: 'SKIPPED', amount: 0, paymentIds: [], refNum: null, error: 'gateway_not_configured' }
  }
  if (!rec.card || rec.card.status !== 'ACTIVE') {
    await markFailure(rec.id, 'Saved card is missing or removed')
    await recordRun(rec.tenantId, rec.id, 'FAILED', 0, null, null, 'Saved card is missing or removed')
    return { status: 'FAILED', amount: 0, paymentIds: [], refNum: null, error: 'card_unavailable' }
  }

  // Determine the amount to charge this cycle.
  let chargeAmount = round2(rec.amount)
  let targetInvoice: { id: string; invoiceNumber: string; balance: number } | null = null

  if (rec.invoiceId) {
    const inv = await prisma.invoice.findFirst({
      where: { id: rec.invoiceId, tenantId: rec.tenantId },
      select: { id: true, invoiceNumber: true, balance: true, status: true },
    })
    if (!inv || ['PAID', 'CANCELLED', 'REFUNDED'].includes(String(inv.status)) || round2(inv.balance) <= 0) {
      // Invoice already settled — complete the schedule, no charge.
      await prisma.recurringPayment.update({
        where: { id: rec.id },
        data: { status: 'COMPLETED', lastRunAt: new Date(), lastError: null },
      })
      await recordRun(rec.tenantId, rec.id, 'SKIPPED', 0, null, null, 'Invoice already settled')
      return { status: 'SKIPPED', amount: 0, paymentIds: [], refNum: null, error: 'invoice_settled' }
    }
    targetInvoice = { id: inv.id, invoiceNumber: inv.invoiceNumber, balance: round2(inv.balance) }
    // Never charge more than the invoice still owes.
    chargeAmount = Math.min(chargeAmount, targetInvoice.balance)
  }

  if (!(chargeAmount > 0)) {
    await recordRun(rec.tenantId, rec.id, 'SKIPPED', 0, null, null, 'Nothing to charge')
    return { status: 'SKIPPED', amount: 0, paymentIds: [], refNum: null, error: 'zero_amount' }
  }

  // 1) Charge the saved card at Cardknox.
  let refNum: string | null = null
  try {
    const result = await chargeSavedCard({
      token: rec.card.token,
      amount: chargeAmount,
      invoiceNumber: targetInvoice?.invoiceNumber,
      description: `Recurring payment${targetInvoice ? ` for ${targetInvoice.invoiceNumber}` : ''}`,
      name: rec.client.name || undefined,
      email: rec.client.email || undefined,
    })
    refNum = result.refNum
  } catch (err: any) {
    const message = String(err?.message || 'Charge failed')
    await markFailure(rec.id, message)
    await recordRun(rec.tenantId, rec.id, 'FAILED', chargeAmount, null, null, message)
    return { status: 'FAILED', amount: chargeAmount, paymentIds: [], refNum: null, error: message }
  }

  // 2) Record the payment(s) in TrimPro (charge already succeeded).
  const paymentIds: string[] = []
  const providerPaymentId = refNum || `ck_${crypto.randomBytes(8).toString('hex')}`
  try {
    if (targetInvoice) {
      const res = await applyInvoicePayment({
        invoiceId: targetInvoice.id,
        amount: chargeAmount,
        method: 'CARD',
        provider: 'cardknox',
        providerPaymentId,
        reference: refNum ? `Recurring card ${refNum}` : 'Recurring card',
        processedAt: new Date(),
        notes: 'Recurring card payment',
        dedupeWhere: { provider: 'cardknox', providerPaymentId },
      })
      if (res.created && res.paymentId) {
        paymentIds.push(res.paymentId)
        await afterInvoicePayment(targetInvoice.id).catch(() => null)
        await enqueueQboSync(rec.tenantId, 'payment', res.paymentId, { processImmediately: true }).catch(() => null)
        await sendPaymentReceiptForPayment(res.paymentId, rec.tenantId).catch(() => null)
      }
    } else {
      // Customer-level: apply across open invoices oldest-first, leftover -> credit.
      const openInvoices = await prisma.invoice.findMany({
        where: {
          tenantId: rec.tenantId,
          clientId: rec.clientId,
          status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] },
          balance: { gt: 0 } as any,
        },
        orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
        select: { id: true },
      })
      const groupId = `pg_recurring_${providerPaymentId}`
      let remaining = chargeAmount
      let idx = 0
      for (const inv of openInvoices) {
        if (remaining <= 0) break
        const res = await applyInvoicePayment({
          invoiceId: inv.id,
          amount: remaining,
          method: 'CARD',
          provider: 'cardknox',
          providerPaymentId: `${providerPaymentId}:${inv.id}`,
          reference: refNum ? `Recurring card ${refNum}` : 'Recurring card',
          processedAt: new Date(),
          notes: 'Recurring card payment',
          paymentGroupId: groupId,
          dedupeWhere: { provider: 'cardknox', providerPaymentId: `${providerPaymentId}:${inv.id}` },
        })
        if (res.created && res.paymentId) {
          paymentIds.push(res.paymentId)
          const row = await prisma.payment.findUnique({
            where: { id: res.paymentId },
            select: { amount: true },
          })
          const applied = round2(row?.amount || 0)
          remaining = round2(remaining - applied)
          await afterInvoicePayment(inv.id).catch(() => null)
          await sendPaymentReceiptForPayment(res.paymentId, rec.tenantId).catch(() => null)
        }
        idx += 1
      }
      if (paymentIds.length > 0) {
        await enqueueQboSync(rec.tenantId, 'payment', paymentIds[0], { processImmediately: true }).catch(() => null)
      }
      // Hold any leftover as customer credit.
      if (remaining > 0.005) {
        await prisma.$transaction(async (tx) => {
          await createOverpaymentCredit(tx, {
            tenantId: rec.tenantId,
            clientId: rec.clientId,
            amount: remaining,
            sourcePaymentId: paymentIds[0] || null,
            sourcePaymentGroupId: groupId,
            reason: 'Recurring card payment (credit on account)',
          })
        })
      }
    }
  } catch (err: any) {
    // The card WAS charged but recording failed — surface loudly; do not re-charge.
    const message = `Charged at gateway (ref ${refNum}) but failed to record: ${String(err?.message || err)}`
    console.error('[recurring] record-after-charge failure:', message)
    await recordRun(rec.tenantId, rec.id, 'FAILED', chargeAmount, null, refNum, message)
    // Still advance the schedule so we don't double-charge next run.
    await advanceSchedule(rec.id)
    return { status: 'FAILED', amount: chargeAmount, paymentIds, refNum, error: message }
  }

  // 3) Advance the schedule and log success.
  await advanceSchedule(rec.id)
  await recordRun(rec.tenantId, rec.id, 'SUCCESS', chargeAmount, paymentIds[0] || null, refNum, null)
  return { status: 'SUCCESS', amount: chargeAmount, paymentIds, refNum }
}

/** Advance nextRunAt by the frequency, counting the occurrence and applying end conditions. */
async function advanceSchedule(recurringId: string): Promise<void> {
  const rec = await prisma.recurringPayment.findUnique({ where: { id: recurringId } })
  if (!rec) return
  const occurrences = rec.occurrences + 1
  let nextRunAt = advanceNextRun(rec.nextRunAt, rec.frequency)
  let status = rec.status
  if (rec.maxOccurrences && occurrences >= rec.maxOccurrences) status = 'COMPLETED'
  if (rec.endDate && nextRunAt.getTime() > new Date(rec.endDate).getTime()) status = 'COMPLETED'
  await prisma.recurringPayment.update({
    where: { id: recurringId },
    data: { occurrences, nextRunAt, status, lastRunAt: new Date(), lastError: null },
  })
}

/** Record a failed attempt; mark the schedule FAILED after too many in a row. */
async function markFailure(recurringId: string, message: string): Promise<void> {
  const recentFails = await prisma.recurringPaymentRun.count({
    where: { recurringPaymentId: recurringId, status: 'FAILED' },
  })
  // +1 for the failure we're about to record.
  const willFail = recentFails + 1
  await prisma.recurringPayment.update({
    where: { id: recurringId },
    data: {
      lastRunAt: new Date(),
      lastError: message,
      // Push the next attempt out a day so we don't hammer a declining card.
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...(willFail >= MAX_CONSECUTIVE_FAILURES ? { status: 'FAILED' } : {}),
    },
  })
}

async function recordRun(
  tenantId: string,
  recurringPaymentId: string,
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED',
  amount: number,
  paymentId: string | null,
  cardknoxRefNum: string | null,
  error: string | null
): Promise<void> {
  await prisma.recurringPaymentRun
    .create({
      data: { tenantId, recurringPaymentId, status, amount, paymentId, cardknoxRefNum, error },
    })
    .catch(() => null)
}

/** Process every ACTIVE schedule that is due. Returns a summary. */
export async function processDueRecurringPayments(limit = 200): Promise<{
  processed: number
  succeeded: number
  failed: number
  skipped: number
}> {
  const due = await prisma.recurringPayment.findMany({
    where: { status: 'ACTIVE', nextRunAt: { lte: new Date() } },
    orderBy: { nextRunAt: 'asc' },
    take: limit,
    select: { id: true },
  })

  let succeeded = 0
  let failed = 0
  let skipped = 0
  for (const row of due) {
    try {
      const res = await processRecurringPayment(row.id)
      if (res.status === 'SUCCESS') succeeded += 1
      else if (res.status === 'FAILED') failed += 1
      else skipped += 1
    } catch (err) {
      failed += 1
      console.error('[recurring] unexpected error processing', row.id, err)
    }
  }
  return { processed: due.length, succeeded, failed, skipped }
}
