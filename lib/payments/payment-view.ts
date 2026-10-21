import { prisma } from '@/lib/prisma'
import { formatPaymentMethodLabel } from '@/lib/payments/receipts'
import {
  getCustomPaymentLabel,
  getCustomPaymentUiMethod,
  isCustomPayment,
  type CustomPaymentUiMethod,
} from '@/lib/payments/custom-payment'

function round2(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}

export type PaymentViewLine = {
  paymentId: string
  invoiceId: string
  invoiceNumber: string
  title: string | null
  dueDate: string | null
  amount: number
  invoiceTotal: number
  invoiceBalance: number
}

export type PaymentOpenInvoice = {
  invoiceId: string
  invoiceNumber: string
  title: string | null
  dueDate: string | null
  total: number
  balance: number
}

export type PaymentView = {
  paymentId: string
  groupId: string | null
  clientId: string
  clientName: string
  method: string
  methodLabel: string
  provider: string | null
  /** Manual/custom payments can change method; gateway (card/ACH) payments cannot. */
  methodEditable: boolean
  customMethod: CustomPaymentUiMethod
  customMethodLabel: string
  reference: string | null
  paidAt: string | null
  totalReceived: number
  appliedTotal: number
  unapplied: number
  lines: PaymentViewLine[]
  openInvoices: PaymentOpenInvoice[]
}

const memberInclude = {
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      title: true,
      dueDate: true,
      total: true,
      balance: true,
      clientId: true,
      tenantId: true,
      client: { select: { name: true } },
    },
  },
} as const

/**
 * Resolve a payment (single or grouped) into a QuickBooks-style view: the total
 * received, the invoices it is applied to (with amounts), the unapplied
 * remainder (held as customer credit), and the customer's other open invoices
 * it could be applied to.
 */
export async function getPaymentView(
  paymentId: string,
  tenantId: string
): Promise<PaymentView | null> {
  const trigger = await prisma.payment.findFirst({
    where: { id: paymentId, invoice: { tenantId } },
    include: memberInclude,
  })
  if (!trigger?.invoice) return null

  const groupId = trigger.paymentGroupId
  const members = groupId
    ? await prisma.payment.findMany({
        where: { paymentGroupId: groupId, status: 'COMPLETED', invoice: { tenantId } },
        include: memberInclude,
        orderBy: { createdAt: 'asc' },
      })
    : [trigger]

  const clientId = trigger.invoice.clientId
  const clientName = trigger.invoice.client?.name || 'Customer'

  const creditWhere = groupId
    ? { sourcePaymentGroupId: groupId, status: 'ACTIVE' as const }
    : { sourcePaymentId: trigger.id, status: 'ACTIVE' as const }
  const creditAgg = await prisma.customerCredit.aggregate({
    where: { ...creditWhere, tenantId },
    _sum: { remainingAmount: true },
  })
  const unapplied = round2(creditAgg._sum.remainingAmount || 0)

  const lines: PaymentViewLine[] = members
    .filter((m) => round2(m.amount) > 0)
    .map((m) => ({
      paymentId: m.id,
      invoiceId: m.invoice.id,
      invoiceNumber: m.invoice.invoiceNumber,
      title: m.invoice.title || null,
      dueDate: m.invoice.dueDate ? m.invoice.dueDate.toISOString() : null,
      amount: round2(m.amount),
      invoiceTotal: round2(m.invoice.total),
      invoiceBalance: round2(m.invoice.balance),
    }))
  const appliedTotal = round2(lines.reduce((s, l) => s + l.amount, 0))

  // Only invoices with a non-zero applied amount are "taken"; a $0 carrier row's
  // invoice should still be offered as re-applyable.
  const memberInvoiceIds = new Set(lines.map((l) => l.invoiceId))
  const open = await prisma.invoice.findMany({
    where: {
      clientId,
      tenantId,
      status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] },
      balance: { gt: 0 },
      id: { notIn: [...memberInvoiceIds] },
    },
    select: { id: true, invoiceNumber: true, title: true, dueDate: true, total: true, balance: true },
    orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
  })
  const openInvoices: PaymentOpenInvoice[] = open.map((i) => ({
    invoiceId: i.id,
    invoiceNumber: i.invoiceNumber,
    title: i.title || null,
    dueDate: i.dueDate ? i.dueDate.toISOString() : null,
    total: round2(i.total),
    balance: round2(i.balance),
  }))

  return {
    paymentId: trigger.id,
    groupId,
    clientId,
    clientName,
    method: trigger.method,
    methodLabel: formatPaymentMethodLabel(trigger),
    provider: trigger.provider,
    methodEditable: isCustomPayment(trigger),
    customMethod: getCustomPaymentUiMethod(trigger),
    customMethodLabel: getCustomPaymentLabel(trigger),
    reference: trigger.reference,
    paidAt: (trigger.processedAt || trigger.createdAt)?.toISOString?.() || null,
    totalReceived: round2(appliedTotal + unapplied),
    appliedTotal,
    unapplied,
    lines,
    openInvoices,
  }
}
