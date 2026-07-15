import { prisma } from '@/lib/prisma'

export type UnifiedDocumentKind = 'estimate' | 'invoice' | 'payment'

export interface UnifiedDocumentRow {
  id: string
  kind: UnifiedDocumentKind
  number: string
  title: string | null
  status: string
  amount: number
  balance: number | null
  isPaid: boolean | null
  date: string
  href: string
  meta?: string | null
  canReceipt?: boolean
  receiptEmailSentAt?: string | null
}

function isInvoicePaid(status: string, balance: number) {
  return status === 'PAID' || status === 'CANCELLED' || status === 'REFUNDED' || balance <= 0
}

function paymentDisplayStatus(status: string, refundStatus: string) {
  if (refundStatus === 'FULLY_REFUNDED') return 'REFUNDED'
  if (refundStatus === 'PARTIALLY_REFUNDED') return 'PARTIALLY_REFUNDED'
  return status
}

function paymentCanReceipt(displayStatus: string) {
  return displayStatus === 'COMPLETED' || displayStatus === 'REFUNDED' || displayStatus === 'PARTIALLY_REFUNDED'
}

export async function fetchClientDocuments(tenantId: string, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, tenantId },
    select: { id: true },
  })

  if (!client) return null

  const [estimates, invoices, payments] = await Promise.all([
    prisma.estimate.findMany({
      where: { tenantId, clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        estimateNumber: true,
        title: true,
        status: true,
        total: true,
        createdAt: true,
      },
    }),
    prisma.invoice.findMany({
      where: { tenantId, clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        title: true,
        status: true,
        total: true,
        balance: true,
        dueDate: true,
        createdAt: true,
      },
    }),
    prisma.payment.findMany({
      where: {
        invoice: { tenantId, clientId },
      },
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        invoice: {
          select: { id: true, invoiceNumber: true },
        },
      },
    }),
  ])

  return buildDocumentRows({ estimates, invoices, payments })
}

export async function fetchJobDocuments(tenantId: string, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId },
    select: { id: true },
  })

  if (!job) return null

  const [estimates, invoices, payments] = await Promise.all([
    prisma.estimate.findMany({
      where: { tenantId, jobId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        estimateNumber: true,
        title: true,
        status: true,
        total: true,
        createdAt: true,
      },
    }),
    prisma.invoice.findMany({
      where: { tenantId, jobId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        title: true,
        status: true,
        total: true,
        balance: true,
        dueDate: true,
        createdAt: true,
      },
    }),
    prisma.payment.findMany({
      where: {
        invoice: { tenantId, jobId },
      },
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        invoice: {
          select: { id: true, invoiceNumber: true },
        },
      },
    }),
  ])

  return buildDocumentRows({ estimates, invoices, payments })
}

function buildDocumentRows({
  estimates,
  invoices,
  payments,
}: {
  estimates: Array<{
    id: string
    estimateNumber: string
    title: string
    status: string
    total: { toString(): string } | number
    createdAt: Date
  }>
  invoices: Array<{
    id: string
    invoiceNumber: string
    title: string
    status: string
    total: { toString(): string } | number
    balance: { toString(): string } | number
    dueDate: Date | null
    createdAt: Date
  }>
  payments: Array<{
    id: string
    amount: { toString(): string } | number
    status: string
    refundStatus: string
    method: string
    reference: string | null
    processedAt: Date | null
    createdAt: Date
    receiptEmailSentAt: Date | null
    invoice: { id: string; invoiceNumber: string } | null
  }>
}): UnifiedDocumentRow[] {
  const rows: UnifiedDocumentRow[] = []

  for (const estimate of estimates) {
    rows.push({
      id: estimate.id,
      kind: 'estimate',
      number: estimate.estimateNumber,
      title: estimate.title,
      status: estimate.status,
      amount: Number(estimate.total),
      balance: null,
      isPaid: null,
      date: estimate.createdAt.toISOString(),
      href: `/dashboard/estimates/${estimate.id}`,
    })
  }

  for (const invoice of invoices) {
    const balance = Number(invoice.balance)
    const total = Number(invoice.total)
    rows.push({
      id: invoice.id,
      kind: 'invoice',
      number: invoice.invoiceNumber,
      title: invoice.title,
      status: invoice.status,
      amount: total,
      balance,
      isPaid: isInvoicePaid(invoice.status, balance),
      date: (invoice.dueDate || invoice.createdAt).toISOString(),
      href: `/dashboard/invoices/${invoice.id}`,
      meta: balance > 0 ? `Balance ${balance.toFixed(2)}` : null,
    })
  }

  for (const payment of payments) {
    const displayStatus = paymentDisplayStatus(payment.status, payment.refundStatus)
    rows.push({
      id: payment.id,
      kind: 'payment',
      number: payment.invoice?.invoiceNumber || payment.reference || payment.id.slice(-8),
      title: payment.method.replace(/_/g, ' '),
      status: displayStatus,
      amount: Number(payment.amount),
      balance: null,
      isPaid: null,
      date: (payment.processedAt || payment.createdAt).toISOString(),
      href: payment.invoice ? `/dashboard/invoices/${payment.invoice.id}` : '#',
      meta: payment.invoice ? `Invoice ${payment.invoice.invoiceNumber}` : null,
      canReceipt: paymentCanReceipt(displayStatus),
      receiptEmailSentAt: payment.receiptEmailSentAt?.toISOString() ?? null,
    })
  }

  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return rows
}
