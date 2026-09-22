import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

const PAID_EPSILON = 0.005
function round2(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}

export type PaymentAllocation = { invoiceId: string; amount: number }

export type ReconcileResult = {
  groupId: string
  totalReceived: number
  appliedTotal: number
  unapplied: number
  affectedInvoiceIds: string[]
  /** Non-zero allocations, for the QBO line sparse-update. */
  qboLines: Array<{ invoiceId: string; amount: number }>
}

/** Recompute an invoice's paidAmount/balance/status from its COMPLETED payments. */
async function recomputeInvoice(tx: Prisma.TransactionClient, invoiceId: string) {
  const inv = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { total: true, status: true, paidAt: true },
  })
  if (!inv) return
  const rows = await tx.payment.findMany({
    where: { invoiceId, status: 'COMPLETED' },
    select: { amount: true },
  })
  const total = round2(inv.total)
  const newPaid = round2(rows.reduce((s, r) => s + round2(r.amount), 0))
  const newBalance = round2(Math.max(0, total - newPaid))
  const fullyPaid = newBalance <= PAID_EPSILON
  const status = fullyPaid
    ? 'PAID'
    : newPaid > 0
      ? 'PARTIAL'
      : ['CANCELLED', 'REFUNDED'].includes(String(inv.status))
        ? String(inv.status)
        : 'SENT'
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      paidAmount: newPaid,
      balance: fullyPaid ? 0 : newBalance,
      status: status as any,
      paidAt: fullyPaid ? (inv.paidAt ?? new Date()) : null,
    },
  })
}

/**
 * Redistribute a payment (single or grouped) across a customer's invoices with
 * exact per-invoice amounts. The payment's TOTAL received stays fixed; whatever
 * is not applied to invoices becomes unapplied (held as customer credit). This
 * is the internal engine — the caller mirrors the result to QuickBooks.
 */
export async function reconcilePaymentAllocations(params: {
  tenantId: string
  paymentId: string
  allocations: PaymentAllocation[]
}): Promise<ReconcileResult> {
  const { tenantId, paymentId, allocations } = params

  return prisma.$transaction(async (tx) => {
    const trigger = await tx.payment.findFirst({
      where: { id: paymentId, invoice: { tenantId } },
      select: {
        id: true,
        paymentGroupId: true,
        method: true,
        provider: true,
        reference: true,
        processedAt: true,
        notes: true,
        currency: true,
        invoice: { select: { clientId: true } },
      },
    })
    if (!trigger?.invoice) throw new Error('Payment not found')
    const clientId = trigger.invoice.clientId

    // Ensure a group id so unapplied credit can be tied to this payment.
    let groupId = trigger.paymentGroupId
    if (!groupId) {
      groupId = `pg_edit_${crypto.randomBytes(10).toString('hex')}`
      await tx.payment.update({ where: { id: trigger.id }, data: { paymentGroupId: groupId } })
    }

    const members = await tx.payment.findMany({
      where: { paymentGroupId: groupId, status: 'COMPLETED' },
      select: { id: true, invoiceId: true, amount: true },
    })
    const credits = await tx.customerCredit.findMany({
      where: { sourcePaymentGroupId: groupId, tenantId },
      orderBy: { createdAt: 'asc' },
    })
    const existingUnapplied = round2(
      credits.filter((c) => c.status === 'ACTIVE').reduce((s, c) => s + round2(c.remainingAmount), 0)
    )
    const appliedNow = round2(members.reduce((s, m) => s + round2(m.amount), 0))
    const totalReceived = round2(appliedNow + existingUnapplied)

    // Desired allocation map (merge dupes, drop negatives).
    const desired = new Map<string, number>()
    for (const a of allocations || []) {
      if (!a?.invoiceId) continue
      const amt = Math.max(0, round2(a.amount))
      desired.set(a.invoiceId, round2((desired.get(a.invoiceId) || 0) + amt))
    }

    const memberByInvoice = new Map(members.map((m) => [m.invoiceId, m]))
    const affected = new Set<string>([...memberByInvoice.keys(), ...desired.keys()])

    const invoices = await tx.invoice.findMany({
      where: { id: { in: [...affected] }, tenantId },
      select: { id: true, clientId: true, total: true, paidAmount: true, status: true },
    })
    const invById = new Map(invoices.map((i) => [i.id, i]))

    // Validate.
    let sumDesired = 0
    for (const [invId, amt] of desired) {
      const inv = invById.get(invId)
      if (!inv) throw new Error('An invoice was not found in this account')
      if (inv.clientId !== clientId) throw new Error('All invoices must belong to the same customer')
      if (['CANCELLED', 'REFUNDED'].includes(String(inv.status))) {
        throw new Error('An invoice cannot receive payment')
      }
      const thisCurrent = round2(memberByInvoice.get(invId)?.amount || 0)
      const maxApplicable = round2(Number(inv.total) - (round2(inv.paidAmount) - thisCurrent))
      if (amt > maxApplicable + PAID_EPSILON) {
        throw new Error(`Amount for invoice exceeds its remaining balance`)
      }
      sumDesired += amt
    }
    sumDesired = round2(sumDesired)
    if (sumDesired > totalReceived + PAID_EPSILON) {
      throw new Error('Applied amounts exceed the payment total received')
    }

    // Lock affected invoices, then mutate payment rows.
    for (const id of affected) {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`
    }
    // Identity-stable reconcile: reuse existing payment rows (never orphan the
    // trigger, so its id keeps resolving) rather than delete+recreate.
    const wants = [...desired.entries()]
      .filter(([, amt]) => round2(amt) > 0)
      .map(([invoiceId, amount]) => ({ invoiceId, amount: round2(amount) }))
    const pool = members.map((m) => ({ id: m.id, invoiceId: m.invoiceId, amount: round2(m.amount) }))
    const used = new Set<string>()

    // 1) Reuse the row already on the target invoice.
    for (const w of wants) {
      const row = pool.find((r) => !used.has(r.id) && r.invoiceId === w.invoiceId)
      if (!row) continue
      used.add(row.id)
      if (row.amount !== w.amount) {
        await tx.payment.update({ where: { id: row.id }, data: { amount: w.amount } })
      }
      w.invoiceId = '__done__'
    }
    // 2) For remaining wants, move a leftover row (prefer keeping the trigger) or create.
    const leftover = pool
      .filter((r) => !used.has(r.id))
      .sort((a, b) => (a.id === trigger.id ? -1 : b.id === trigger.id ? 1 : 0))
    for (const w of wants) {
      if (w.invoiceId === '__done__') continue
      const row = leftover.shift()
      if (row) {
        used.add(row.id)
        await tx.payment.update({
          where: { id: row.id },
          data: { invoiceId: w.invoiceId, amount: w.amount },
        })
      } else {
        await tx.payment.create({
          data: {
            invoiceId: w.invoiceId,
            amount: w.amount,
            currency: trigger.currency || 'USD',
            status: 'COMPLETED',
            method: trigger.method,
            provider: trigger.provider,
            reference: trigger.reference,
            paymentGroupId: groupId,
            processedAt: trigger.processedAt ?? new Date(),
            notes: trigger.notes,
          },
        })
      }
    }
    // 3) Dispose of any unused rows. Keep the trigger alive as a $0 carrier when
    //    the payment ends up fully unapplied, so the payment id still resolves.
    const unused = pool.filter((r) => !used.has(r.id))
    for (const row of unused) {
      if (row.id === trigger.id && wants.length === 0) {
        if (row.amount !== 0) await tx.payment.update({ where: { id: row.id }, data: { amount: 0 } })
      } else {
        await tx.payment.delete({ where: { id: row.id } })
      }
    }

    for (const invId of affected) {
      await recomputeInvoice(tx, invId)
    }

    // Persist unapplied remainder as the group's customer credit.
    const newUnapplied = round2(totalReceived - sumDesired)
    const activeCredit = credits.find((c) => c.status === 'ACTIVE') || credits[0]
    if (newUnapplied > 0) {
      if (activeCredit) {
        await tx.customerCredit.update({
          where: { id: activeCredit.id },
          data: { remainingAmount: newUnapplied, status: 'ACTIVE' },
        })
        for (const c of credits) {
          if (c.id !== activeCredit.id && c.status === 'ACTIVE') {
            await tx.customerCredit.update({ where: { id: c.id }, data: { remainingAmount: 0, status: 'DEPLETED' } })
          }
        }
      } else {
        await tx.customerCredit.create({
          data: {
            tenantId,
            clientId,
            originalAmount: newUnapplied,
            remainingAmount: newUnapplied,
            status: 'ACTIVE',
            reason: 'Unapplied payment',
            sourcePaymentId: trigger.id,
            sourcePaymentGroupId: groupId,
          },
        })
      }
    } else {
      for (const c of credits) {
        if (c.status === 'ACTIVE') {
          await tx.customerCredit.update({ where: { id: c.id }, data: { remainingAmount: 0, status: 'DEPLETED' } })
        }
      }
    }

    const qboLines = [...desired.entries()]
      .filter(([, amt]) => amt > 0)
      .map(([invoiceId, amount]) => ({ invoiceId, amount: round2(amount) }))

    return {
      groupId,
      totalReceived,
      appliedTotal: sumDesired,
      unapplied: newUnapplied,
      affectedInvoiceIds: [...affected],
      qboLines,
    }
  })
}
