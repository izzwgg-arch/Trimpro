import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyIntuitWebhookSignature, hashPayload } from '@/lib/qbo/webhook'
import { rateLimitOrThrow } from '@/lib/security/rate-limit'
import { getQboSessionForTenant } from '@/lib/qbo/session'
import { quickBooksService } from '@/lib/services/quickbooks'
import { notifyInvoicePaid } from '@/lib/notifications'
import { sendPaymentReceiptEmail } from '@/lib/services/email'
import { splitEmailList } from '@/lib/email'

export const dynamic = 'force-dynamic'

function moneyToNumber(v: any): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function applyInvoicePayment(params: {
  tenantId: string
  invoiceId: string
  amount: number
  reference: string
  rawEvent: any
}) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    include: {
      client: {
        select: {
          name: true,
          email: true,
          contacts: {
            where: { email: { not: null } },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            take: 1,
            select: { email: true },
          },
        },
      },
      tenant: { select: { name: true } },
    },
  })
  if (!invoice) return

  // Idempotency: reference is unique on Payment.reference.
  const existing = await prisma.payment.findFirst({
    where: { reference: params.reference },
  })
  if (existing) return

  const remainingBeforePayment = Math.max(0, Number(invoice.total) - Number(invoice.paidAmount))
  const amount = Math.max(0, Math.min(params.amount, remainingBeforePayment))
  if (amount <= 0) return

  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amount,
        status: 'COMPLETED',
        method: 'ACH',
        reference: params.reference,
        processedAt: new Date(),
        notes: 'QuickBooks Payments (ACH)',
      },
    })

    const newPaidAmount = Number(invoice.paidAmount) + amount
    const newBalance = Math.max(0, Number(invoice.total) - newPaidAmount)
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: newPaidAmount,
        balance: newBalance,
        status: newBalance <= 0 ? 'PAID' : newPaidAmount > 0 ? 'PARTIAL' : invoice.status,
        paidAt: newBalance <= 0 ? new Date() : invoice.paidAt,
      },
    })

    await tx.paymentTransaction.create({
      data: {
        tenantId: params.tenantId,
        provider: 'qbo_ach',
        status: 'succeeded',
        amount: amount as any,
        currency: 'USD',
        externalId: params.reference,
        invoiceId: invoice.id,
        rawEvent: params.rawEvent ?? undefined,
        metadata: { source: 'qbo_webhook' },
      },
    })
  })

  await notifyInvoicePaid(
    params.tenantId,
    invoice.id,
    invoice.invoiceNumber,
    amount,
    invoice.client?.name || 'Customer'
  )

  // Customer-facing receipt email (best effort).
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
        reference: params.reference,
        companyName: invoice.tenant?.name || null,
        invoiceUrl: `${String(appUrl).replace(/\/+$/, '')}/portal/pay/${invoice.id}`,
      })
    }
  } catch (e) {
    console.error('[QBO ACH] Failed to send receipt email:', e)
  }
}

export async function POST(request: NextRequest) {
  try {
    rateLimitOrThrow(request, { key: 'qbo-webhook', limit: 120, windowMs: 60_000 })
  } catch (res: any) {
    return res
  }

  const rawBody = await request.text()
  const signature = request.headers.get('intuit-signature')
  const verifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN

  const ok = verifyIntuitWebhookSignature({ rawBody, signatureHeader: signature, verifierToken })
  if (!ok) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payloadHash = hashPayload(rawBody)

  const notifications: any[] = Array.isArray(payload?.eventNotifications) ? payload.eventNotifications : []
  for (const n of notifications) {
    const realmId = String(n?.realmId || '')
    if (!realmId) continue

    // Find the tenant for this realm.
    const qboRow = await prisma.quickBooksIntegration.findFirst({
      where: { realmId, isConnected: true },
      select: { tenantId: true },
    })
    if (!qboRow?.tenantId) continue

    const dataChange = n?.dataChangeEvent
    const entities: any[] = Array.isArray(dataChange?.entities) ? dataChange.entities : []

    for (const e of entities) {
      const name = String(e?.name || e?.entityName || '')
      const id = String(e?.id || '')
      const operation = String(e?.operation || '')
      const seq = String(e?.sequenceNumber || '')

      const providerEventId = `qbo:${realmId}:${name}:${id}:${operation}:${seq}`

      // Store webhook event for idempotency + audit.
      const already = await prisma.webhookEvent.findUnique({
        where: { eventId: providerEventId },
        select: { id: true },
      })
      if (already) continue

      const webhookRow = await prisma.webhookEvent.create({
        data: {
          tenantId: qboRow.tenantId,
          provider: 'quickbooks',
          eventId: providerEventId,
          eventType: name || 'unknown',
          rawPayload: payload,
          payloadHash,
          processed: false,
        },
      })

      try {
        // We primarily care about Payment events (ACH completion).
        if (name.toLowerCase() === 'payment' && id) {
          const session = await getQboSessionForTenant(qboRow.tenantId)
          if (!session) throw new Error('QBO session missing for tenant')

          const paymentRes = await quickBooksService.makeAPIRequest(
            session.accessToken,
            session.realmId,
            `/payment/${id}`,
            'GET'
          )
          const payment = paymentRes?.Payment
          const totalAmt = moneyToNumber(payment?.TotalAmt)
          const lines: any[] = Array.isArray(payment?.Line) ? payment.Line : []
          const linked = lines.flatMap((l) => (Array.isArray(l?.LinkedTxn) ? l.LinkedTxn : []))
          const linkedInvoices = linked.filter((t) => String(t?.TxnType || '').toLowerCase() === 'invoice')

          for (const li of linkedInvoices) {
            const qboInvoiceId = String(li?.TxnId || '')
            if (!qboInvoiceId) continue
            const localInvoice = await prisma.invoice.findFirst({
              where: { tenantId: qboRow.tenantId, qboSyncId: qboInvoiceId },
              select: { id: true },
            })
            if (!localInvoice?.id) continue

            // Update latest open ACH intent (if any).
            const intent = await prisma.invoicePaymentIntent.findFirst({
              where: {
                tenantId: qboRow.tenantId,
                invoiceId: localInvoice.id,
                provider: 'qbo',
                method: 'ach',
                status: { in: ['CREATED', 'LINK_CREATED', 'PENDING'] as any },
              },
              orderBy: { createdAt: 'desc' },
            })

            if (intent) {
              await prisma.invoicePaymentIntent.update({
                where: { id: intent.id },
                data: {
                  status: 'SUCCEEDED',
                  qboPaymentId: id,
                },
              })
              await prisma.paymentEvent.create({
                data: {
                  tenantId: qboRow.tenantId,
                  intentId: intent.id,
                  provider: 'qbo',
                  providerEventId,
                  type: 'webhook',
                  statusFrom: intent.status,
                  statusTo: 'SUCCEEDED',
                  payloadHash,
                  rawPayload: payload,
                },
              })
            }

            // Apply to local invoice ledger.
            await applyInvoicePayment({
              tenantId: qboRow.tenantId,
              invoiceId: localInvoice.id,
              amount: totalAmt,
              reference: `qbo_payment_${id}`,
              rawEvent: payload,
            })
          }
        }

        await prisma.webhookEvent.update({
          where: { id: webhookRow.id },
          data: { processed: true, processedAt: new Date(), error: null },
        })
      } catch (err: any) {
        await prisma.webhookEvent.update({
          where: { id: webhookRow.id },
          data: { processed: false, processedAt: new Date(), error: err?.message || 'Webhook processing failed' },
        })
      }
    }
  }

  return NextResponse.json({ ok: true })
}

