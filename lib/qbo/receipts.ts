import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendPaymentReceiptEmail } from '@/lib/services/email'
import { splitEmailList } from '@/lib/email'

function randomToken() {
  return crypto.randomBytes(32).toString('hex')
}

function appBaseUrl() {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.CANONICAL_PUBLIC_APP_URL ||
    'https://app.trimprony.com'
  ).replace(/\/+$/, '')
}

export async function sendPaymentReceiptIfNeeded(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      invoice: {
        include: {
          tenant: { select: { name: true } },
          client: {
            select: {
              email: true,
              contacts: {
                where: { email: { not: null } },
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                take: 1,
                select: { email: true },
              },
            },
          },
        },
      },
    },
  })
  if (!payment?.invoice) {
    return { sent: false, reason: 'payment_not_found' as const }
  }
  if (payment.receiptEmailSentAt) {
    return { sent: false, reason: 'already_sent' as const }
  }

  // Acquire an idempotency lock so concurrent webhook retries cannot double-send.
  const lockKey = `payment_receipt_send:${payment.id}`
  try {
    await prisma.idempotencyKey.create({
      data: {
        tenantId: payment.invoice.tenantId,
        key: lockKey,
        scope: 'payment_receipt_send',
        requestHash: lockKey,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
  } catch {
    return { sent: false, reason: 'already_processing' as const }
  }

  const to =
    splitEmailList(payment.invoice.client?.email || '')[0] ||
    String(payment.invoice.client?.contacts?.[0]?.email || '').trim() ||
    ''
  if (!to) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        receiptEmailAttempts: { increment: 1 },
        receiptEmailError: 'No recipient email found',
      },
    })
    return { sent: false, reason: 'missing_email' as const }
  }

  const receiptToken = payment.receiptToken || randomToken()
  const receiptTokenExpiresAt = payment.receiptTokenExpiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const receiptUrl = `${appBaseUrl()}/pay/receipt/${encodeURIComponent(receiptToken)}`
  const invoiceUrl = `${appBaseUrl()}/portal/pay/${payment.invoice.id}`

  try {
    await sendPaymentReceiptEmail({
      to,
      invoiceNumber: payment.invoice.invoiceNumber,
      amount: Number(payment.amount || 0),
      paidAt: payment.processedAt || payment.updatedAt || new Date(),
      reference: payment.reference,
      companyName: payment.invoice.tenant?.name || null,
      invoiceUrl,
      receiptUrl,
      paymentMethod: 'ACH (QuickBooks)',
      providerPaymentId: payment.providerPaymentId || null,
      providerInvoiceId: payment.providerInvoiceId || null,
    })

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        receiptToken,
        receiptTokenExpiresAt,
        receiptEmailSentAt: new Date(),
        receiptEmailError: null,
        receiptEmailAttempts: { increment: 1 },
      },
    })

    return { sent: true, reason: 'sent' as const, receiptUrl }
  } catch (error: any) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        receiptToken,
        receiptTokenExpiresAt,
        receiptEmailAttempts: { increment: 1 },
        receiptEmailError: error?.message || 'Unknown receipt send error',
      },
    })
    return { sent: false, reason: 'send_failed' as const, error: error?.message || 'send_failed' }
  } finally {
    await prisma.idempotencyKey.deleteMany({ where: { key: lockKey } }).catch(() => undefined)
  }
}

export async function retryPendingPaymentReceipts(limit = 50) {
  const rows = await prisma.payment.findMany({
    where: {
      provider: 'quickbooks',
      status: 'COMPLETED',
      receiptEmailSentAt: null,
      receiptEmailAttempts: { lt: 10 },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: { id: true },
  })

  let sent = 0
  let failed = 0
  for (const row of rows) {
    const result = await sendPaymentReceiptIfNeeded(row.id)
    if (result.sent) sent += 1
    else failed += 1
  }

  return { scanned: rows.length, sent, failed }
}
