import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getQboSessionForTenant } from '@/lib/qbo/session'
import { quickBooksService } from '@/lib/services/quickbooks'
import { notifyInvoicePaid } from '@/lib/notifications'
import { sendPaymentReceiptEmail } from '@/lib/services/email'
import { splitEmailList } from '@/lib/email'

async function reconcileFromQboIfNeeded(invoiceId: string) {
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
  if (localBalance <= 0) return
  if (!invoice.qboSyncId) return

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

  const paidDelta = Math.max(0, localBalance - qboBalance)
  if (paidDelta <= 0.009) return

  const amount = Math.min(localBalance, paidDelta)
  const reference = `qbo_reconcile_${String(invoice.qboSyncId)}_${Date.now()}`

  await prisma.$transaction(async (tx) => {
    // Re-read inside tx so repeated refreshes stay idempotent.
    const current = await tx.invoice.findUnique({
      where: { id: invoice.id },
      select: { id: true, total: true, paidAmount: true, balance: true, status: true, paidAt: true },
    })
    if (!current) return

    const curBalance = Number(current.balance || 0)
    if (curBalance <= 0) return
    const applyAmount = Math.min(curBalance, amount)
    if (applyAmount <= 0) return

    const existing = await tx.payment.findFirst({ where: { reference } })
    if (existing) return

    await tx.payment.create({
      data: {
        invoiceId: current.id,
        amount: applyAmount,
        status: 'COMPLETED',
        method: 'ACH',
        reference,
        processedAt: new Date(),
        notes: 'QuickBooks ACH reconcile',
      },
    })

    const newPaidAmount = Number(current.paidAmount) + applyAmount
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
        amount: applyAmount as any,
        currency: 'USD',
        externalId: reference,
        invoiceId: current.id,
        metadata: { source: 'qbo_reconcile_fetch' },
      },
    })
  })

  await notifyInvoicePaid(
    invoice.tenantId,
    invoice.id,
    invoice.invoiceNumber,
    amount,
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
        amount,
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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = request.nextUrl.searchParams.get('token') || ''
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 })
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: params.id,
        paymentToken: token,
      },
      include: {
        client: true,
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Webhook/redirect fallback: if QBO has newer payment state, reconcile it into TrimPro on fetch.
    try {
      await reconcileFromQboIfNeeded(invoice.id)
    } catch (e) {
      console.error('[QBO ACH] Reconcile on public invoice fetch failed:', e)
    }

    const freshInvoice = await prisma.invoice.findFirst({
      where: { id: invoice.id },
      include: {
        client: true,
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
    if (!freshInvoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const outstandingWhere = {
      tenantId: freshInvoice.tenantId,
      clientId: freshInvoice.clientId,
      balance: { gt: 0 },
      status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] as any },
    }

    const [outstandingCount, outstandingAgg, outstandingInvoices] = await Promise.all([
      prisma.invoice.count({ where: outstandingWhere as any }),
      prisma.invoice.aggregate({
        where: outstandingWhere as any,
        _sum: { balance: true },
      }),
      prisma.invoice.findMany({
        where: outstandingWhere as any,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          balance: true,
          invoiceDate: true,
          dueDate: true,
        },
        orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
        take: 200,
      }),
    ])

    return NextResponse.json({
      invoice: {
        id: freshInvoice.id,
        invoiceNumber: freshInvoice.invoiceNumber,
        title: freshInvoice.title,
        status: freshInvoice.status,
        subtotal: freshInvoice.subtotal.toString(),
        taxAmount: freshInvoice.taxAmount.toString(),
        total: freshInvoice.total.toString(),
        balance: freshInvoice.balance.toString(),
        qboAchEnabled: freshInvoice.qboAchEnabled,
        invoiceDate: freshInvoice.invoiceDate,
        dueDate: freshInvoice.dueDate,
        client: {
          name: freshInvoice.client.name,
          companyName: freshInvoice.client.companyName,
        },
        lineItems: freshInvoice.lineItems.map((li) => ({
          id: li.id,
          description: li.description,
          quantity: li.quantity.toString(),
          unitPrice: li.unitPrice.toString(),
          total: li.total.toString(),
        })),
        outstanding: {
          count: outstandingCount,
          total: Number((outstandingAgg as any)?._sum?.balance ?? 0),
          invoices: outstandingInvoices.map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            status: (inv as any).status,
            balance: inv.balance.toString(),
            invoiceDate: inv.invoiceDate,
            dueDate: inv.dueDate,
            isCurrent: inv.id === freshInvoice.id,
          })),
        },
      },
    })
  } catch (error) {
    console.error('Public invoice fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

