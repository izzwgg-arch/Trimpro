import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyInvoicePaid } from '@/lib/notifications'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { testEmailProvider } from '@/lib/integrations/providers/email'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import { getEmailBranding } from '@/lib/email/branding'
import {
  buildBulkPaymentReceiptEmail,
  buildInvoicePaymentReceiptEmail,
} from '@/lib/email/templates/payment-receipt'
import { orderInvoicesByStoredIds } from '@/lib/payments/bulk-card-allocation'
import { afterInvoicePayment } from '@/lib/payments/after-invoice-payment'

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`
}

async function sendPaymentReceiptEmail(params: {
  tenantId: string
  to: string
  clientName: string
  invoiceId: string
  invoiceNumber: string
  invoiceToken?: string | null
  amountPaid: number
  paidToDate: number
  balance: number
  transactionId?: string
}) {
  const emailSecrets = await getIntegrationSecrets(params.tenantId, 'email')
  if (!emailSecrets) {
    console.warn('Receipt email skipped: Email integration not configured')
    return
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://app.trimprony.com'

  const now = new Date()
  const subject = `Payment Receipt • Invoice ${params.invoiceNumber} • ${now.toISOString()}`
  const receiptUrl = `${appUrl}/portal/pay/${params.invoiceId}${
    params.invoiceToken ? `?token=${encodeURIComponent(params.invoiceToken)}` : ''
  }`
  const emailBranding = await getEmailBranding(params.tenantId)
  const brandLogoUrl = String(emailBranding?.emailLogoUrl || emailBranding?.webLogoUrl || '').trim()
  const html = buildInvoicePaymentReceiptEmail({
    clientName: params.clientName,
    invoiceNumber: params.invoiceNumber,
    amountPaid: money(params.amountPaid),
    paidToDate: money(params.paidToDate),
    balance: money(params.balance),
    transactionId: params.transactionId,
    receiptUrl,
    logoUrl: brandLogoUrl || undefined,
    companyName:
      (emailBranding as { businessName?: string; companyName?: string } | null)?.businessName ||
      (emailBranding as { companyName?: string } | null)?.companyName ||
      'TrimPro',
  })

  const result = await testEmailProvider(emailSecrets, params.to, subject, html)
  if (!result.success) {
    console.error('Failed to send payment receipt email:', result.error || result.message)
  }
}

async function sendBulkPaymentReceiptEmail(params: {
  tenantId: string
  to: string
  clientName: string
  amountPaid: number
  appliedCount: number
  transactionId?: string
}) {
  const emailSecrets = await getIntegrationSecrets(params.tenantId, 'email')
  if (!emailSecrets) return

  const now = new Date()
  const subject = `Payment Receipt • ${params.appliedCount} invoice(s) • ${now.toISOString()}`
  const emailBranding = await getEmailBranding(params.tenantId)
  const brandLogoUrl = String(emailBranding?.emailLogoUrl || emailBranding?.webLogoUrl || '').trim()
  const portalUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://app.trimprony.com'
  const html = buildBulkPaymentReceiptEmail({
    clientName: params.clientName,
    amountPaid: money(params.amountPaid),
    appliedCount: params.appliedCount,
    transactionId: params.transactionId,
    portalUrl: `${portalUrl.replace(/\/$/, '')}/portal`,
    logoUrl: brandLogoUrl || undefined,
    companyName:
      (emailBranding as { businessName?: string; companyName?: string } | null)?.businessName ||
      (emailBranding as { companyName?: string } | null)?.companyName ||
      'TrimPro',
  })

  const result = await testEmailProvider(emailSecrets, params.to, subject, html)
  if (!result.success) {
    console.error('Failed to send bulk payment receipt email:', result.error || result.message)
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    let body: Record<string, any> = {}
    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      // Cardknox commonly posts x-www-form-urlencoded (xResult=...&xInvoice=...)
      const params = new URLSearchParams(rawBody)
      body = Object.fromEntries(params.entries())
    }

    const resultCode = String(body?.Result || body?.result || body?.xResult || '')
    const paymentStatus = String(body?.status || '').toLowerCase()
    const normalizedResult = resultCode.toUpperCase()
    const isSuccess =
      normalizedResult === 'S' ||
      normalizedResult === 'A' ||
      normalizedResult === 'APPROVED' ||
      paymentStatus === 'completed' ||
      paymentStatus === 'paid' ||
      paymentStatus === 'approved'
    if (!isSuccess) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    // xCustom1 carries the intent key when xInvoice is set to human-readable invoice numbers
    const intentRefRaw = String(body?.xCustom1 || body?.xCustom || '')
    const invoiceRefRaw = String(body?.invoiceId || body?.xInvoice || body?.InvoiceID || '')
    // Prefer the explicit intent ref; fall back to xInvoice if it contains the TPINTENT prefix
    let invoiceRef = intentRefRaw.startsWith('TPINTENT:')
      ? intentRefRaw
      : invoiceRefRaw.startsWith('TPINTENT:')
        ? invoiceRefRaw
        : invoiceRefRaw

    // Cardknox sometimes omits xCustom1 on return/webhook while xInvoice lists multiple numbers.
    if (!invoiceRef.startsWith('TPINTENT:') && invoiceRef.includes(',')) {
      const invoiceNumbers = invoiceRef
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
      if (invoiceNumbers.length > 1) {
        const recentIntents = await prisma.idempotencyKey.findMany({
          where: {
            scope: 'public_payment_intent',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { key: true, response: true },
        })
        for (const row of recentIntents) {
          const resp = (row.response || {}) as any
          const nums = Array.isArray(resp?.invoiceNumbers)
            ? resp.invoiceNumbers.map((n: any) => String(n || '').trim()).filter(Boolean)
            : []
          if (!nums.length) continue
          const matches =
            invoiceNumbers.length === nums.length &&
            invoiceNumbers.every((num) => nums.includes(num))
          if (matches) {
            invoiceRef = `TPINTENT:${row.key}`
            break
          }
        }
      }
    }

    if (!invoiceRef) {
      return NextResponse.json({ error: 'Missing invoice reference' }, { status: 400 })
    }

    const paidAmount = Number(body?.amount || body?.xAmount || 0)
    const transactionId = String(
      body?.transactionId || body?.TransactionID || body?.xRefNum || body?.xRefnum || ''
    )

    // Bulk payment reference format: "TPINTENT:<intentKey>"
    if (invoiceRef.startsWith('TPINTENT:')) {
      const intentKey = invoiceRef.slice('TPINTENT:'.length).trim()
      if (!intentKey) return NextResponse.json({ error: 'Missing intent reference' }, { status: 400 })

      const intent = await prisma.idempotencyKey.findUnique({
        where: { key: intentKey },
        select: { tenantId: true, response: true, expiresAt: true },
      })
      if (!intent) return NextResponse.json({ error: 'Payment intent not found' }, { status: 404 })
      if (intent.expiresAt && new Date(intent.expiresAt).getTime() < Date.now()) {
        return NextResponse.json({ error: 'Payment intent expired' }, { status: 400 })
      }

      const resp = (intent.response || {}) as any
      const clientId = String(resp?.clientId || '').trim()
      const invoiceIds = Array.isArray(resp?.invoiceIds) ? resp.invoiceIds.map((x: any) => String(x || '').trim()).filter(Boolean) : []
      const plannedAmountsByInvoice =
        resp?.plannedAmountsByInvoice && typeof resp.plannedAmountsByInvoice === 'object'
          ? (resp.plannedAmountsByInvoice as Record<string, any>)
          : null
      const allocationMode = typeof resp?.allocationMode === 'string' ? String(resp.allocationMode) : null
      const maxTotalAmount = resp?.maxTotalAmount != null ? Number(resp.maxTotalAmount) : null
      if (!clientId || !invoiceIds.length) {
        return NextResponse.json({ error: 'Invalid payment intent' }, { status: 400 })
      }

      const client = await prisma.client.findFirst({
        where: { id: clientId },
        include: {
          contacts: {
            where: { isPrimary: true },
            take: 1,
          },
        },
      })
      if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

      const openInvoices = orderInvoicesByStoredIds(
        invoiceIds,
        await prisma.invoice.findMany({
          where: {
            tenantId: intent.tenantId,
            clientId: client.id,
            id: { in: invoiceIds },
            balance: { gt: 0 } as any,
            status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] as any },
          },
        })
      )

      const totalOutstanding = openInvoices.reduce((sum, inv) => sum + Math.max(0, Number(inv.balance || 0)), 0)
      const plannedTotal = plannedAmountsByInvoice
        ? openInvoices.reduce((sum, inv) => sum + Math.max(0, Number(plannedAmountsByInvoice[String(inv.id)] || 0)), 0)
        : 0
      let remaining = paidAmount > 0 ? paidAmount : totalOutstanding
      if (plannedAmountsByInvoice && plannedTotal > 0) {
        remaining = Math.min(remaining, plannedTotal)
      }
      if (allocationMode === 'waterfall' && maxTotalAmount != null && Number.isFinite(maxTotalAmount) && maxTotalAmount > 0) {
        remaining = Math.min(remaining, maxTotalAmount)
      }
      let appliedCount = 0
      let appliedTotal = 0

      for (const inv of openInvoices) {
        if (remaining <= 0) break
        const invBalance = Math.max(0, Number(inv.balance || 0))
        if (invBalance <= 0) continue
        const plannedForThis = plannedAmountsByInvoice ? Number(plannedAmountsByInvoice[String(inv.id)] || 0) : 0
        const maxForThis =
          plannedAmountsByInvoice && plannedForThis > 0
            ? Math.min(invBalance, plannedForThis)
            : invBalance
        const amountForThis = Math.min(remaining, maxForThis)
        if (amountForThis <= 0) continue

        const uniqueTxn = transactionId ? `${transactionId}:${inv.id}` : `BULK:${Date.now()}:${inv.id}`
        const exists = await prisma.payment.findFirst({
          where: { solaTransactionId: uniqueTxn },
          select: { id: true },
        })
        if (exists) continue

        const invoiceRef = inv.invoiceNumber ? `Invoice ${inv.invoiceNumber}` : `Invoice ${inv.id}`
        const cleanTxnId = transactionId ? String(transactionId).trim() : ''
        const createdPayment = await prisma.payment.create({
          data: {
            invoiceId: inv.id,
            amount: amountForThis,
            status: 'COMPLETED',
            method: 'CARD',
            provider: 'sola',
            // Unique per invoice — same card txn pays multiple invoices.
            providerPaymentId: uniqueTxn || null,
            reference: cleanTxnId ? `${cleanTxnId} - ${invoiceRef}` : invoiceRef,
            solaTransactionId: uniqueTxn,
            solaWebhookData: body,
            processedAt: new Date(),
            notes: `Bulk payment for ${invoiceRef}`,
          } as any,
        })

        try {
          await enqueueQboSync(client.tenantId, 'payment', createdPayment.id, { processImmediately: true })
        } catch (error) {
          console.error('QuickBooks payment sync trigger error (bulk):', error)
        }

        const newPaidAmount = Number(inv.paidAmount || 0) + amountForThis
        const newBalance = Math.max(0, Number(inv.total || 0) - newPaidAmount)
        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            paidAmount: newPaidAmount,
            balance: newBalance,
            status:
              newBalance <= 0
                ? (inv.progressBillingMode && inv.progressBillingMode !== 'FULL' ? 'PARTIAL' : 'PAID')
                : newPaidAmount > 0
                  ? 'PARTIAL'
                  : inv.status,
            paidAt: newBalance <= 0 ? new Date() : inv.paidAt,
            solaTransactionId: transactionId || inv.solaTransactionId,
          } as any,
        })

        try {
          await afterInvoicePayment(inv.id)
        } catch (error) {
          console.error('[sola-payment] afterInvoicePayment failed (bulk):', {
            invoiceId: inv.id,
            error,
          })
        }

        appliedCount += 1
        appliedTotal += amountForThis
        remaining -= amountForThis
      }

      // Notify office/admin/accounting once (avoid spamming N notifications)
      try {
        const firstInvoice = openInvoices[0]
        if (firstInvoice && appliedCount > 0) {
          await notifyInvoicePaid(
            client.tenantId,
            firstInvoice.id,
            appliedCount > 1 ? `${firstInvoice.invoiceNumber} (+${appliedCount - 1} more)` : firstInvoice.invoiceNumber,
            appliedTotal,
            client.name || 'Customer',
            {
              paymentMethod: 'CARD',
              providerPaymentId: transactionId || null,
              dedupeKey: `payment-received-bulk:${client.tenantId}:${transactionId || 'bulk'}`,
            }
          )
        }
      } catch {
        // ignore
      }

      // Receipt email (single)
      try {
        const to = client.email || client.contacts?.[0]?.email
        if (to && appliedCount > 0 && appliedTotal > 0) {
          await sendBulkPaymentReceiptEmail({
            tenantId: client.tenantId,
            to,
            clientName: client.name || 'Customer',
            amountPaid: appliedTotal,
            appliedCount,
            transactionId: transactionId || undefined,
          })
        }
      } catch (error) {
        console.error('Bulk receipt email error:', error)
      }

      return NextResponse.json({ ok: true, bulk: true, appliedCount, appliedTotal })
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [{ id: invoiceRef }, { invoiceNumber: invoiceRef }],
      },
      include: {
        client: {
          include: {
            contacts: {
              where: { isPrimary: true },
              take: 1,
            },
          },
        },
        estimate: {
          include: {
            lead: true,
          },
        },
      job: {
        select: { id: true, jobNumber: true, title: true },
      },
    },
  })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const remainingBeforePayment = Math.max(0, Number(invoice.total) - Number(invoice.paidAmount))
    const requestedAmount = paidAmount > 0 ? paidAmount : Number(invoice.balance)
    const amount = Math.max(0, Math.min(requestedAmount, remainingBeforePayment))

    const existingPayment = transactionId
      ? await prisma.payment.findFirst({
          where: { solaTransactionId: transactionId },
        })
      : null

    let newPaidAmount = Number(invoice.paidAmount)
    let newBalance = Number(invoice.balance)

    if (!existingPayment && amount > 0) {
      const createdPayment = await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount,
          status: 'COMPLETED',
          method: 'CARD',
          provider: 'sola',
          providerPaymentId: String(transactionId || ''),
          providerInvoiceId: String(invoiceRef || invoice.invoiceNumber || ''),
          reference: transactionId || null,
          solaTransactionId: transactionId || null,
          solaWebhookData: body,
          processedAt: new Date(),
        },
      })

      try {
        await enqueueQboSync(invoice.tenantId, 'payment', createdPayment.id, { processImmediately: true })
      } catch (error) {
        console.error('QuickBooks payment sync trigger error:', error)
      }
      newPaidAmount = Number(invoice.paidAmount) + amount
      newBalance = Math.max(0, Number(invoice.total) - newPaidAmount)

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaidAmount,
          balance: newBalance,
          status:
            newBalance <= 0
              ? (invoice.progressBillingMode && invoice.progressBillingMode !== 'FULL' ? 'PARTIAL' : 'PAID')
              : newPaidAmount > 0
                ? 'PARTIAL'
                : invoice.status,
          paidAt: newBalance <= 0 ? new Date() : invoice.paidAt,
          solaTransactionId: transactionId || invoice.solaTransactionId,
        },
      })

      const recipientEmail = invoice.client.email || invoice.client.contacts?.[0]?.email
      if (recipientEmail) {
        await sendPaymentReceiptEmail({
          tenantId: invoice.tenantId,
          to: recipientEmail,
          clientName: invoice.client.name || 'Customer',
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceToken: invoice.paymentToken,
          amountPaid: amount,
          paidToDate: newPaidAmount,
          balance: newBalance,
          transactionId: transactionId || undefined,
        })
      }
    }

    if (!existingPayment) {
      await notifyInvoicePaid(
        invoice.tenantId,
        invoice.id,
        invoice.invoiceNumber,
        amount,
        invoice.client.name,
        {
          paymentMethod: 'CARD',
          providerPaymentId: transactionId || null,
          dedupeKey: `payment-received:${invoice.tenantId}:${invoice.id}:${transactionId || invoice.id}`,
        }
      )
    }

    if (newPaidAmount > 0) {
      await afterInvoicePayment(invoice.id)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Sola payment webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

