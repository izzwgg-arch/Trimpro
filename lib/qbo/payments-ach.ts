import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { quickBooksService } from '@/lib/services/quickbooks'
import { getQboSessionForTenant, assertQuickBooksAchEnabledFlag } from './session'

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function randomPublicToken(): string {
  // 256-bit token (unguessable)
  return crypto.randomBytes(32).toString('hex')
}

export type AchSessionResult = {
  intentId: string
  publicUrl: string
  hostedUrl: string
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://app.trimprony.com'
  ).replace(/\/+$/, '')
}

/**
 * Fetch QBO invoice, enable hosted online ACH if possible, and return the InvoiceLink.
 *
 * Intuit behavior notes:
 * - Online ACH availability depends on QuickBooks Payments being enabled for the company.
 * - If Payments isn't enabled, QBO may ignore AllowOnlineACHPayment or not provide InvoiceLink.
 */
async function ensureQboInvoiceAchHostedLink(params: {
  accessToken: string
  realmId: string
  qboInvoiceId: string
}): Promise<string> {
  const getInvoice = async () => {
    const res = await quickBooksService.makeAPIRequest(
      params.accessToken,
      params.realmId,
      `/invoice/${params.qboInvoiceId}`,
      'GET'
    )
    return res?.Invoice || res?.QueryResponse?.Invoice?.[0] || null
  }

  const inv = await getInvoice()
  if (!inv?.Id) {
    throw new Error('QuickBooks invoice not found.')
  }

  const maybeLink = inv.InvoiceLink || inv?.InvoiceLinkUri || inv?.OnlineInvoiceLink || inv?.OnlineInvoiceUrl
  if (inv.AllowOnlineACHPayment && maybeLink) {
    return String(maybeLink)
  }

  // Update invoice to allow online payments (ACH).
  const payload: any = {
    Id: String(inv.Id),
    SyncToken: String(inv.SyncToken || '0'),
    sparse: true,
    AllowOnlinePayment: true,
    AllowOnlineACHPayment: true,
  }

  await quickBooksService.makeAPIRequest(
    params.accessToken,
    params.realmId,
    `/invoice?operation=update`,
    'POST',
    payload
  )

  const updated = await getInvoice()
  const updatedLink =
    updated?.InvoiceLink || updated?.InvoiceLinkUri || updated?.OnlineInvoiceLink || updated?.OnlineInvoiceUrl

  if (!updatedLink) {
    throw new Error(
      'QuickBooks did not provide a hosted payment link. QuickBooks Payments (ACH) may not be enabled for this company.'
    )
  }

  return String(updatedLink)
}

export async function createAchPaymentSession(params: {
  tenantId: string
  invoiceId: string
  createdById: string | null
}): Promise<AchSessionResult> {
  assertQuickBooksAchEnabledFlag()

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    include: {
      client: { select: { email: true } },
    },
  })
  if (!invoice) throw new Error('Invoice not found.')

  if (!invoice.qboSyncId) {
    throw new Error('Invoice is not synced to QuickBooks yet (missing QuickBooks invoice id).')
  }

  if (Number(invoice.balance) <= 0) {
    throw new Error('Invoice has no balance due.')
  }

  const session = await getQboSessionForTenant(params.tenantId)
  if (!session) {
    throw new Error('QuickBooks is not connected for this company.')
  }

  const amount = invoice.balance
  const currency = 'USD'
  const idempotencyKey = sha256(
    `qbo_ach_session:${params.tenantId}:${invoice.id}:${String(invoice.qboSyncId)}:${String(amount)}:${currency}`
  )

  const existingKey = await prisma.idempotencyKey.findUnique({
    where: { key: idempotencyKey },
  })
  if (existingKey?.response) {
    const resp: any = existingKey.response
    if (resp?.publicUrl && resp?.hostedUrl && resp?.intentId) {
      return { intentId: resp.intentId, publicUrl: resp.publicUrl, hostedUrl: resp.hostedUrl }
    }
  }

  const hostedUrl = await ensureQboInvoiceAchHostedLink({
    accessToken: session.accessToken,
    realmId: session.realmId,
    qboInvoiceId: String(invoice.qboSyncId),
  })

  const publicToken = randomPublicToken()
  const intent = await prisma.invoicePaymentIntent.create({
    data: {
      tenantId: params.tenantId,
      invoiceId: invoice.id,
      provider: 'qbo',
      method: 'ach',
      amount,
      currency,
      status: 'LINK_CREATED',
      qboRealmId: session.realmId,
      qboInvoiceId: String(invoice.qboSyncId),
      hostedUrl,
      publicToken,
      idempotencyKey,
      createdById: params.createdById || null,
      customerEmail: invoice.client?.email || null,
      metadata: {
        source: 'invoice_detail',
        invoiceNumber: invoice.invoiceNumber || invoice.id,
        qboInvoiceId: String(invoice.qboSyncId),
      },
    },
  })

  const publicUrl = `${appBaseUrl()}/pay/invoice/${publicToken}`

  await prisma.idempotencyKey.upsert({
    where: { key: idempotencyKey },
    create: {
      tenantId: params.tenantId,
      key: idempotencyKey,
      scope: 'qbo_ach_create_session',
      requestHash: idempotencyKey,
      response: { intentId: intent.id, publicUrl, hostedUrl },
      expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
    },
    update: {
      response: { intentId: intent.id, publicUrl, hostedUrl },
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    },
  })

  await prisma.paymentEvent.create({
    data: {
      tenantId: params.tenantId,
      intentId: intent.id,
      provider: 'qbo',
      type: 'create_session',
      statusFrom: 'CREATED',
      statusTo: 'LINK_CREATED',
      payloadHash: sha256(hostedUrl),
    },
  })

  return { intentId: intent.id, publicUrl, hostedUrl }
}

export async function getAchStatusByInvoice(params: { tenantId: string; invoiceId: string }) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    select: { id: true, qboAchEnabled: true, qboSyncId: true, balance: true, status: true },
  })
  if (!invoice) throw new Error('Invoice not found.')

  const latest = await prisma.invoicePaymentIntent.findFirst({
    where: {
      tenantId: params.tenantId,
      invoiceId: params.invoiceId,
      provider: 'qbo',
      method: 'ach',
    },
    orderBy: { createdAt: 'desc' },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })

  return { invoice, latest }
}

