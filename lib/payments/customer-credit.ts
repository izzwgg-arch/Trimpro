import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { applyInvoicePayment } from '@/lib/payments/apply-payment'

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** Total unused credit available to a client. */
export async function getClientCreditBalance(clientId: string, tenantId: string): Promise<number> {
  const agg = await prisma.customerCredit.aggregate({
    where: { clientId, tenantId, status: 'ACTIVE' },
    _sum: { remainingAmount: true },
  })
  return round2(Number(agg._sum.remainingAmount || 0))
}

export async function listActiveClientCredits(clientId: string, tenantId: string) {
  return prisma.customerCredit.findMany({
    where: { clientId, tenantId, status: 'ACTIVE', remainingAmount: { gt: 0 } },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * Record an overpayment as a customer credit. Call inside the same transaction
 * that recorded the payments, passing the tx client.
 */
export async function createOverpaymentCredit(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    clientId: string
    amount: number
    sourcePaymentId?: string | null
    sourcePaymentGroupId?: string | null
    reason?: string | null
  }
) {
  const amount = round2(params.amount)
  if (amount <= 0) return null
  return tx.customerCredit.create({
    data: {
      tenantId: params.tenantId,
      clientId: params.clientId,
      originalAmount: amount,
      remainingAmount: amount,
      status: 'ACTIVE',
      reason: params.reason || 'Customer overpayment',
      sourcePaymentId: params.sourcePaymentId || null,
      sourcePaymentGroupId: params.sourcePaymentGroupId || null,
    },
  })
}

export type CreditApplicationResult = {
  applied: number
  paymentId: string | null
  invoiceId: string
  /** Per-credit consumption, for QuickBooks reconciliation. */
  consumed: Array<{ creditId: string; amount: number; qboPaymentId: string | null }>
}

/**
 * Apply a client's available credit toward an invoice. Consumes ACTIVE credits
 * FIFO up to the lesser of the requested amount, the invoice's remaining
 * balance, and the total available credit. Records ONE CREDIT-method payment
 * against the invoice and marks the consumed credits. Does NOT touch QuickBooks
 * (the caller does the sparse-update using the returned `consumed` list).
 */
export async function applyClientCreditToInvoice(params: {
  tenantId: string
  invoiceId: string
  amount: number
  userId?: string | null
}): Promise<CreditApplicationResult> {
  const requested = round2(params.amount)
  if (requested <= 0) {
    return { applied: 0, paymentId: null, invoiceId: params.invoiceId, consumed: [] }
  }

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: params.invoiceId, tenantId: params.tenantId },
      select: { id: true, clientId: true, total: true, paidAmount: true, status: true },
    })
    if (!invoice) throw new Error('Invoice not found')
    if (invoice.status === 'CANCELLED' || invoice.status === 'REFUNDED') {
      throw new Error('Invoice cannot accept payments')
    }

    const remaining = round2(Number(invoice.total) - Number(invoice.paidAmount))
    if (remaining <= 0) throw new Error('Invoice is already fully paid')

    const credits = await tx.customerCredit.findMany({
      where: { clientId: invoice.clientId, tenantId: params.tenantId, status: 'ACTIVE', remainingAmount: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    })
    const available = round2(credits.reduce((s, c) => s + Number(c.remainingAmount), 0))
    if (available <= 0) throw new Error('No customer credit available')

    const target = round2(Math.min(requested, remaining, available))
    if (target <= 0) throw new Error('Nothing to apply')

    // Record a single CREDIT payment against the invoice.
    const pay = await applyInvoicePayment(
      {
        invoiceId: invoice.id,
        tenantId: params.tenantId,
        amount: target,
        method: 'CREDIT',
        provider: 'customer_credit',
        notes: 'Applied from customer account credit',
      },
      { tx }
    )
    if (!pay.created || !pay.paymentId) {
      throw new Error(`Failed to apply credit${pay.reason ? ` (${pay.reason})` : ''}`)
    }

    // Consume credits FIFO.
    let toConsume = target
    const consumed: CreditApplicationResult['consumed'] = []
    for (const credit of credits) {
      if (toConsume <= 0) break
      const take = round2(Math.min(Number(credit.remainingAmount), toConsume))
      if (take <= 0) continue
      const newRemaining = round2(Number(credit.remainingAmount) - take)
      await tx.customerCredit.update({
        where: { id: credit.id },
        data: {
          remainingAmount: newRemaining,
          status: newRemaining <= 0 ? 'DEPLETED' : 'ACTIVE',
        },
      })
      await tx.customerCreditApplication.create({
        data: {
          tenantId: params.tenantId,
          creditId: credit.id,
          invoiceId: invoice.id,
          paymentId: pay.paymentId,
          amount: take,
        },
      })
      consumed.push({ creditId: credit.id, amount: take, qboPaymentId: credit.qboPaymentId })
      toConsume = round2(toConsume - take)
    }

    return { applied: target, paymentId: pay.paymentId, invoiceId: invoice.id, consumed }
  })
}
