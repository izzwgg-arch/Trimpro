import { prisma } from '@/lib/prisma'
import { getQboSessionForTenant } from '@/lib/qbo/session'
import { quickBooksService } from '@/lib/services/quickbooks'
import { notifyInvoicePaid } from '@/lib/notifications'
import { sendPaymentReceiptEmail } from '@/lib/services/email'
import { splitEmailList } from '@/lib/email'

function toMoney(n: number) {
  return Math.round(n * 100) / 100
}

export async function reconcileTenantRecentAchPayments(tenantId: string): Promise<void> {
  const intents = await prisma.invoicePaymentIntent.findMany({
    where: {
      tenantId,
      provider: 'qbo',
      method: 'ach',
      status: { in: ['CREATED', 'LINK_CREATED', 'PENDING'] as any },
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { invoiceId: true },
  })

  const invoiceIds = Array.from(new Set(intents.map((i) => i.invoiceId).filter(Boolean)))
  for (const invoiceId of invoiceIds) {
    try {
      await reconcileSingleInvoiceAchPayment(invoiceId)
    } catch (e) {
      console.error('[QBO ACH] Reconcile (tenant sweep) failed:', { tenantId, invoiceId, error: e })
    }
  }
}

export async function reconcileSingleInvoiceAchPayment(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      client: {
        include: {
          contacts: {
            where: { email: { not: null } },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            take: 1,
          },
        },
      },
      tenant: { select: { name: true } },
    },
  })
  if (!invoice) return
  const localBalance = Number(invoice.balance || 0)
  if (localBalance <= 0 || !invoice.qboSyncId) return

  const session = await getQboSessionForTenant(invoice.tenantId)
  if (!session) return

  const qboRes = await quickBooksService.makeAPIRequest(
    session.accessToken,
    session.realmId,
    `/invoice/${invoice.qboSyncId}`,
    'GET'
  )
  const qboInvoice = qboRes?.Invoice
  const qboBalance = Number(qboInvoice?.Balance ?? qboInvoice?.BalanceAmt ?? NaN)
  if (!Number.isFinite(qboBalance)) return

  const baselineDelta = toMoney(localBalance - qboBalance)
  if (baselineDelta <= 0) return

  const reference = `qbo_reconcile_${invoice.qboSyncId}_${qboBalance.toFixed(2)}`
  let appliedAmount = 0

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.invoice.findUnique({
        where: { id: invoice.id },
        select: { id: true, total: true, paidAmount: true, balance: true, status: true, paidAt: true },
      })
      if (!current) return

      const curBalance = Number(current.balance || 0)
      if (curBalance <= 0) return

      const delta = toMoney(curBalance - qboBalance)
      if (delta <= 0) return

      const exists = await tx.payment.findFirst({ where: { reference } })
      if (exists) return

      appliedAmount = Math.min(curBalance, delta)
      if (appliedAmount <= 0) return

      await tx.payment.create({
        data: {
          invoiceId: current.id,
          amount: appliedAmount,
          status: 'COMPLETED',
          method: 'ACH',
          reference,
          processedAt: new Date(),
          notes: 'QuickBooks ACH reconcile',
        },
      })

      const newPaidAmount = Number(current.paidAmount) + appliedAmount
      const newBalance = Math.max(0, Number(current.total) - newPaidAmount)
      await tx.invoice.update({
        where: { id: current.id },
        data: {
          paidAmount: newPaidAmount,
          balance: newBalance,
          status: newBalance <= 0 ? 'PAID' : newPaidAmount > 0 ? 'PARTIAL' : current.status,
          paidAt: newBalance <= 0 ? new Date() : current.paidAt,
        },
      })

      await tx.paymentTransaction.create({
        data: {
          tenantId: invoice.tenantId,
          provider: 'qbo_ach',
          status: 'succeeded',
          amount: appliedAmount as any,
          currency: 'USD',
          externalId: reference,
          invoiceId: current.id,
          metadata: { source: 'qbo_reconcile_sweep' },
        },
      })
    })
  } catch (e: any) {
    // Reference is unique; ignore race duplicates.
    if (e?.code !== 'P2002') throw e
  }

  if (appliedAmount <= 0) return

  await prisma.invoicePaymentIntent.updateMany({
    where: {
      tenantId: invoice.tenantId,
      invoiceId: invoice.id,
      provider: 'qbo',
      method: 'ach',
      status: { in: ['CREATED', 'LINK_CREATED', 'PENDING'] as any },
    },
    data: { status: 'SUCCEEDED' as any },
  })

  await notifyInvoicePaid(
    invoice.tenantId,
    invoice.id,
    invoice.invoiceNumber,
    appliedAmount,
    invoice.client?.name || 'Customer'
  )

  try {
    const to =
      splitEmailList(invoice.client?.email || '')[0] ||
      String(invoice.client?.contacts?.[0]?.email || '').trim() ||
      ''
    if (to) {
      const appUrl =
        process.env.PUBLIC_APP_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.CANONICAL_PUBLIC_APP_URL ||
        'https://app.trimprony.com'
      await sendPaymentReceiptEmail({
        to,
        invoiceNumber: invoice.invoiceNumber,
        amount: appliedAmount,
        paidAt: new Date(),
        reference,
        companyName: invoice.tenant?.name || null,
        invoiceUrl: `${String(appUrl).replace(/\/+$/, '')}/portal/pay/${invoice.id}`,
      })
    }
  } catch (e) {
    console.error('[QBO ACH] Reconcile receipt email failed:', e)
  }
}

