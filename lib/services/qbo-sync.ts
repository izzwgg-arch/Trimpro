import { prisma } from '@/lib/prisma'
import { quickBooksService } from '@/lib/services/quickbooks'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { encryptSecrets } from '@/lib/integrations/secrets'
import { getPrimaryEmail } from '@/lib/email'
import crypto from 'crypto'

type SyncType =
  | 'client'
  | 'project'
  | 'estimate'
  | 'invoice'
  | 'payment'
  | 'item'
  | 'vendor'
  | 'purchase_order'

function toNumber(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function qboDate(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10)
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function esc(value: string): string {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function logSync(params: {
  integrationId: string
  type: SyncType
  action: string
  status: 'success' | 'error' | 'conflict'
  entityId?: string | null
  qboId?: string | null
  error?: string | null
  data?: any
}) {
  await prisma.quickBooksSyncLog.create({
    data: {
      integrationId: params.integrationId,
      type: params.type,
      action: params.action,
      status: params.status,
      entityId: params.entityId || null,
      qboId: params.qboId || null,
      error: params.error || null,
      data: params.data ?? undefined,
    },
  })
}

async function getQboSession(tenantId: string) {
  const integration = await prisma.quickBooksIntegration.findUnique({ where: { tenantId } })
  if (!integration || !integration.isConnected || !integration.realmId) return null

  // Prefer encrypted IntegrationConnection('quickbooks') secrets for tokens.
  const secrets = await getIntegrationSecrets(tenantId, 'quickbooks' as any)
  const realmId = String(secrets?.realmId || integration.realmId || '')
  const refreshToken = String(secrets?.refreshToken || integration.refreshToken || '')
  let accessToken = String(secrets?.accessToken || integration.accessToken || '')

  if (!realmId || !refreshToken) return null

  const expiresAtRaw = secrets?.tokenExpiresAt || integration.tokenExpiresAt
  const expiresAt = expiresAtRaw ? new Date(String(expiresAtRaw)) : null
  const isExpired = expiresAt ? expiresAt.getTime() <= Date.now() + 30_000 : false

  if (!accessToken || isExpired) {
    try {
      // Use saved clientId/clientSecret from IntegrationConnection if available, otherwise fall back to env vars
      const clientId = secrets?.clientId || null
      const clientSecret = secrets?.clientSecret || null
      const refreshed = await quickBooksService.refreshAccessToken(refreshToken, clientId || undefined, clientSecret || undefined)
      accessToken = refreshed.access_token
      const newRefresh = refreshed.refresh_token || refreshToken
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000)

      // Persist into encrypted IntegrationConnection if present.
      if (secrets) {
        const merged = {
          ...secrets,
          accessToken: refreshed.access_token,
          refreshToken: newRefresh,
          realmId,
          tokenExpiresAt: newExpiresAt.toISOString(),
        }
        await prisma.integrationConnection.update({
          where: { tenantId_provider: { tenantId, provider: 'quickbooks' } },
          data: {
            encryptedSecrets: encryptSecrets(merged),
            status: 'CONNECTED',
            lastCheckedAt: new Date(),
            lastError: null,
            metadata: { realmId, refreshedAt: new Date().toISOString() },
          },
        })
      }

      // Backwards compatibility for older paths.
      await prisma.quickBooksIntegration.update({
        where: { tenantId },
        data: {
          accessToken: refreshed.access_token,
          refreshToken: newRefresh,
          tokenExpiresAt: newExpiresAt,
          realmId,
        },
      })
    } catch (error: any) {
      const message = error?.message || 'Failed to refresh QuickBooks access token'
      // Surface this to the UI so actions don't "silently" do nothing.
      try {
        await prisma.integrationConnection.update({
          where: { tenantId_provider: { tenantId, provider: 'quickbooks' } },
          data: {
            status: 'ERROR',
            lastCheckedAt: new Date(),
            lastError: message,
          },
        })
      } catch {}
      throw error
    }
  }

  return {
    integrationId: integration.id,
    tenantId,
    realmId,
    accessToken,
    incomeAccountId: integration.incomeAccountId || null,
  }
}

async function getMappedQboId(integrationId: string, type: SyncType, entityId: string) {
  const row = await prisma.quickBooksSyncLog.findFirst({
    where: {
      integrationId,
      type,
      entityId,
      status: 'success',
      qboId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  })
  return row?.qboId || null
}

async function findCustomerByDisplayName(
  accessToken: string,
  realmId: string,
  displayName: string
) {
  const query = `select * from Customer where DisplayName='${esc(displayName)}' maxresults 1`
  const res = await quickBooksService.query(accessToken, realmId, query)
  return res?.QueryResponse?.Customer?.[0] || null
}

async function findVendorByDisplayName(
  accessToken: string,
  realmId: string,
  displayName: string
) {
  const query = `select * from Vendor where DisplayName='${esc(displayName)}' maxresults 1`
  const res = await quickBooksService.query(accessToken, realmId, query)
  return res?.QueryResponse?.Vendor?.[0] || null
}

async function ensureIncomeAccount(accessToken: string, realmId: string) {
  const res = await quickBooksService.query(
    accessToken,
    realmId,
    "select * from Account where AccountType='Income' maxresults 1"
  )
  const account = res?.QueryResponse?.Account?.[0]
  return account?.Id ? String(account.Id) : null
}

async function ensureExpenseAccount(accessToken: string, realmId: string) {
  const cogs = await quickBooksService.query(
    accessToken,
    realmId,
    "select * from Account where AccountType='Cost of Goods Sold' maxresults 1"
  )
  const cogsAccount = cogs?.QueryResponse?.Account?.[0]
  if (cogsAccount?.Id) return String(cogsAccount.Id)

  const expense = await quickBooksService.query(
    accessToken,
    realmId,
    "select * from Account where AccountType='Expense' maxresults 1"
  )
  const expenseAccount = expense?.QueryResponse?.Account?.[0]
  return expenseAccount?.Id ? String(expenseAccount.Id) : null
}

async function ensureDefaultServiceItem(params: {
  accessToken: string
  realmId: string
  incomeAccountId: string | null
}) {
  const found = await quickBooksService.query(
    params.accessToken,
    params.realmId,
    "select * from Item where Name='Trim Pro Service' maxresults 1"
  )
  const existing = found?.QueryResponse?.Item?.[0]
  if (existing?.Id) return String(existing.Id)

  let incomeAccountId = params.incomeAccountId
  if (!incomeAccountId) {
    incomeAccountId = await ensureIncomeAccount(params.accessToken, params.realmId)
  }
  if (!incomeAccountId) {
    throw new Error('Unable to resolve QuickBooks income account for service item.')
  }

  const created = await quickBooksService.createItem(params.accessToken, params.realmId, {
    Name: 'Trim Pro Service',
    Type: 'Service',
    IncomeAccountRef: { value: incomeAccountId },
    Active: true,
  })
  return String(created?.Item?.Id || '')
}

async function ensureClientCustomer(params: {
  tenantId: string
  clientId: string
  accessToken: string
  realmId: string
  integrationId: string
  createIfMissing?: boolean
}) {
  const client = await prisma.client.findFirst({
    where: { id: params.clientId, tenantId: params.tenantId },
    include: {
      addresses: {
        where: { type: 'billing' },
        take: 1,
      },
    },
  })
  if (!client) return null

  const mappedId = await getMappedQboId(params.integrationId, 'client', client.id)
  const createIfMissing = params.createIfMissing !== false
  const billing = client.addresses?.[0]
  const primaryEmail = getPrimaryEmail(client.email)
  const payload: any = {
    DisplayName: client.name,
    CompanyName: client.companyName || client.name,
    // QBO supports a single email. TrimPro can store comma-separated emails.
    PrimaryEmailAddr: primaryEmail ? { Address: primaryEmail } : undefined,
    PrimaryPhone: client.phone ? { FreeFormNumber: client.phone } : undefined,
    BillAddr: billing
      ? {
          Line1: billing.street,
          City: billing.city,
          CountrySubDivisionCode: billing.state,
          PostalCode: billing.zipCode,
          Country: billing.country || 'US',
        }
      : undefined,
  }

  try {
    if (mappedId) {
      const current = await quickBooksService.makeAPIRequest(
        params.accessToken,
        params.realmId,
        `/customer/${mappedId}`
      )
      const syncToken = current?.Customer?.SyncToken || '0'
      const updated = await quickBooksService.updateCustomer(
        params.accessToken,
        params.realmId,
        mappedId,
        { ...payload, SyncToken: syncToken, sparse: true }
      )
      const qboId = String(updated?.Customer?.Id || mappedId)
      await logSync({
        integrationId: params.integrationId,
        type: 'client',
        action: 'update',
        status: 'success',
        entityId: client.id,
        qboId,
      })
      return qboId
    }
  } catch (error: any) {
    await logSync({
      integrationId: params.integrationId,
      type: 'client',
      action: 'update',
      status: 'error',
      entityId: client.id,
      qboId: mappedId,
      error: error?.message || 'QuickBooks customer update failed',
    })
  }

  // Try to link by DisplayName without creating duplicates.
  const candidates = Array.from(
    new Set([client.name, client.companyName].map((v) => String(v || '').trim()).filter(Boolean))
  )
  for (const candidate of candidates) {
    const existing = await findCustomerByDisplayName(params.accessToken, params.realmId, candidate)
    if (existing?.Id) {
      const qboId = String(existing.Id)
      await logSync({
        integrationId: params.integrationId,
        type: 'client',
        action: 'link',
        status: 'success',
        entityId: client.id,
        qboId,
        data: { matchedDisplayName: candidate },
      })
      return qboId
    }
  }

  if (!createIfMissing) {
    await logSync({
      integrationId: params.integrationId,
      type: 'client',
      action: 'skip',
      status: 'success',
      entityId: client.id,
      error:
        'QuickBooks customer is not linked yet. Skipping customer creation because createIfMissing=false (will create on invoice conversion).',
    })
    return null
  }

  const created = await quickBooksService.createCustomer(params.accessToken, params.realmId, payload)
  const qboId = String(created?.Customer?.Id || '')
  if (!qboId) throw new Error('QuickBooks did not return customer id')
  await logSync({
    integrationId: params.integrationId,
    type: 'client',
    action: 'create',
    status: 'success',
    entityId: client.id,
    qboId,
  })
  return qboId
}

async function ensureProjectCustomer(params: {
  integrationId: string
  accessToken: string
  realmId: string
  localEntityId: string
  displayName: string
  parentCustomerQboId: string
}) {
  const mappedId = await getMappedQboId(params.integrationId, 'project', params.localEntityId)
  if (mappedId) return mappedId

  const query = `select * from Customer where DisplayName='${esc(params.displayName)}' and Job=true maxresults 1`
  const found = await quickBooksService.query(params.accessToken, params.realmId, query)
  const existing = found?.QueryResponse?.Customer?.[0]
  if (existing?.Id) {
    const qboId = String(existing.Id)
    await logSync({
      integrationId: params.integrationId,
      type: 'project',
      action: 'link',
      status: 'success',
      entityId: params.localEntityId,
      qboId,
    })
    return qboId
  }

  const created = await quickBooksService.createCustomer(params.accessToken, params.realmId, {
    DisplayName: params.displayName,
    FullyQualifiedName: params.displayName,
    ParentRef: { value: params.parentCustomerQboId },
    Job: true,
    BillWithParent: true,
  })
  const qboId = String(created?.Customer?.Id || '')
  if (!qboId) throw new Error('QuickBooks did not return project id')
  await logSync({
    integrationId: params.integrationId,
    type: 'project',
    action: 'create',
    status: 'success',
    entityId: params.localEntityId,
    qboId,
  })
  return qboId
}

export async function syncClientToQuickBooks(tenantId: string, clientId: string) {
  const session = await getQboSession(tenantId)
  if (!session) return
  try {
    await ensureClientCustomer({
      tenantId,
      clientId,
      accessToken: session.accessToken,
      realmId: session.realmId,
      integrationId: session.integrationId,
      createIfMissing: true,
    })
  } catch (error: any) {
    await logSync({
      integrationId: session.integrationId,
      type: 'client',
      action: 'create',
      status: 'error',
      entityId: clientId,
      error: error?.message || 'QuickBooks client sync failed',
    })
  }
}

export async function syncLeadToQuickBooksProject(tenantId: string, leadId: string) {
  const session = await getQboSession(tenantId)
  if (!session) return
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        email: true,
        phone: true,
        convertedToClientId: true,
      },
    })
    if (!lead) return

    let parentQboCustomerId: string | null = null
    if (lead.convertedToClientId) {
      parentQboCustomerId = await ensureClientCustomer({
        tenantId,
        clientId: lead.convertedToClientId,
        accessToken: session.accessToken,
        realmId: session.realmId,
        integrationId: session.integrationId,
        createIfMissing: false,
      })
    }

    if (!parentQboCustomerId) {
      const baseName = lead.company || `${lead.firstName} ${lead.lastName}`.trim()
      const existing = await findCustomerByDisplayName(session.accessToken, session.realmId, baseName)
      if (existing?.Id) {
        parentQboCustomerId = String(existing.Id)
      } else {
        const created = await quickBooksService.createCustomer(session.accessToken, session.realmId, {
          DisplayName: baseName,
          CompanyName: lead.company || baseName,
          PrimaryEmailAddr: lead.email ? { Address: lead.email } : undefined,
          PrimaryPhone: lead.phone ? { FreeFormNumber: lead.phone } : undefined,
        })
        parentQboCustomerId = String(created?.Customer?.Id || '')
      }
    }
    if (!parentQboCustomerId) return

    const displayName = `${lead.company || `${lead.firstName} ${lead.lastName}`.trim()} - Request ${lead.id.slice(-6)}`
    await ensureProjectCustomer({
      integrationId: session.integrationId,
      accessToken: session.accessToken,
      realmId: session.realmId,
      localEntityId: lead.id,
      displayName,
      parentCustomerQboId: parentQboCustomerId,
    })
  } catch (error: any) {
    await logSync({
      integrationId: session.integrationId,
      type: 'project',
      action: 'create',
      status: 'error',
      entityId: leadId,
      error: error?.message || 'QuickBooks request project sync failed',
    })
  }
}

export async function syncJobToQuickBooksProject(tenantId: string, jobId: string) {
  const session = await getQboSession(tenantId)
  if (!session) return
  try {
    const job = await prisma.job.findFirst({
      where: { id: jobId, tenantId },
      include: {
        client: true,
      },
    })
    if (!job?.clientId) return

    const parentQboCustomerId = await ensureClientCustomer({
      tenantId,
      clientId: job.clientId,
      accessToken: session.accessToken,
      realmId: session.realmId,
      integrationId: session.integrationId,
      createIfMissing: false,
    })
    if (!parentQboCustomerId) return

    const displayName = `${job.jobNumber} - ${job.title}`.slice(0, 100)
    await ensureProjectCustomer({
      integrationId: session.integrationId,
      accessToken: session.accessToken,
      realmId: session.realmId,
      localEntityId: job.id,
      displayName,
      parentCustomerQboId: parentQboCustomerId,
    })
  } catch (error: any) {
    await logSync({
      integrationId: session.integrationId,
      type: 'project',
      action: 'create',
      status: 'error',
      entityId: jobId,
      error: error?.message || 'QuickBooks job project sync failed',
    })
  }
}

export async function syncEstimateToQuickBooks(tenantId: string, estimateId: string) {
  const session = await getQboSession(tenantId)
  if (!session) return
  try {
    const estimate = await prisma.estimate.findFirst({
      where: { id: estimateId, tenantId },
      include: {
        client: true,
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
    if (!estimate?.clientId) return

    let customerQboId = await ensureClientCustomer({
      tenantId,
      clientId: estimate.clientId,
      accessToken: session.accessToken,
      realmId: session.realmId,
      integrationId: session.integrationId,
      // Strict flow: only create QBO customers when we explicitly create a new client in TrimPro
      // (Clients page or "New Client" request). For existing clients, we link by name; no create.
      createIfMissing: false,
    })
    if (!customerQboId) {
      // Best-effort: if this looks like a newly created client (very recent), try syncing the client
      // first (which is allowed for "new client" flow) and then re-attempt link-only resolution.
      const clientCreatedAt = (estimate as any)?.client?.createdAt
      const estimateCreatedAt = estimate.createdAt
      const isLikelyNewClient =
        clientCreatedAt instanceof Date &&
        Math.abs(estimateCreatedAt.getTime() - clientCreatedAt.getTime()) < 10 * 60 * 1000

      if (isLikelyNewClient) {
        await syncClientToQuickBooks(tenantId, estimate.clientId)
        customerQboId = await ensureClientCustomer({
          tenantId,
          clientId: estimate.clientId,
          accessToken: session.accessToken,
          realmId: session.realmId,
          integrationId: session.integrationId,
          createIfMissing: false,
        })
      }
    }
    if (!customerQboId) return

    const existingQboId = await getMappedQboId(session.integrationId, 'estimate', estimate.id)
    if (existingQboId) {
      await logSync({
        integrationId: session.integrationId,
        type: 'estimate',
        action: 'skip',
        status: 'success',
        entityId: estimate.id,
        qboId: existingQboId,
      })
      return
    }

    const serviceItemId = await ensureDefaultServiceItem({
      accessToken: session.accessToken,
      realmId: session.realmId,
      incomeAccountId: session.incomeAccountId,
    })

    const lineItems = estimate.lineItems.length
      ? estimate.lineItems
      : [
          {
            id: 'fallback',
            description: estimate.title,
            quantity: 1 as any,
            unitPrice: estimate.total as any,
          },
        ]

    const payload: any = {
      DocNumber: estimate.estimateNumber,
      CustomerRef: { value: customerQboId },
      TxnDate: qboDate(estimate.createdAt),
      ExpirationDate: qboDate(estimate.validUntil || estimate.createdAt),
      PrivateNote: estimate.notes || undefined,
      Line: lineItems.map((li: any) => ({
        DetailType: 'SalesItemLineDetail',
        Description: li.notes || li.description, // Use notes (description) if available, otherwise use item name
        Amount: toNumber(li.quantity) * toNumber(li.unitPrice),
        SalesItemLineDetail: {
          ItemRef: { value: serviceItemId },
          Qty: toNumber(li.quantity),
          UnitPrice: toNumber(li.unitPrice),
        },
      })),
    }

    const created = await quickBooksService.makeAPIRequest(
      session.accessToken,
      session.realmId,
      '/estimate',
      'POST',
      payload
    )
    const qboId = String(created?.Estimate?.Id || '')
    if (!qboId) throw new Error('QuickBooks did not return estimate id')

    await logSync({
      integrationId: session.integrationId,
      type: 'estimate',
      action: 'create',
      status: 'success',
      entityId: estimate.id,
      qboId,
    })
  } catch (error: any) {
    await logSync({
      integrationId: session.integrationId,
      type: 'estimate',
      action: 'create',
      status: 'error',
      entityId: estimateId,
      error: error?.message || 'QuickBooks estimate sync failed',
    })
  }
}

export async function syncInvoiceToQuickBooks(tenantId: string, invoiceId: string) {
  const session = await getQboSession(tenantId)
  if (!session) return
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: {
        client: true,
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
    if (!invoice?.clientId) return

    const customerQboId = await ensureClientCustomer({
      tenantId,
      clientId: invoice.clientId,
      accessToken: session.accessToken,
      realmId: session.realmId,
      integrationId: session.integrationId,
      createIfMissing: true,
    })
    if (!customerQboId) return

    if (invoice.qboSyncId) {
      await logSync({
        integrationId: session.integrationId,
        type: 'invoice',
        action: 'skip',
        status: 'success',
        entityId: invoice.id,
        qboId: invoice.qboSyncId,
      })
      return
    }

    const serviceItemId = await ensureDefaultServiceItem({
      accessToken: session.accessToken,
      realmId: session.realmId,
      incomeAccountId: session.incomeAccountId,
    })

    const lineItems = invoice.lineItems.length
      ? invoice.lineItems
      : [
          {
            id: 'fallback',
            description: invoice.title,
            quantity: 1 as any,
            unitPrice: invoice.total as any,
          },
        ]

    const payload: any = {
      DocNumber: invoice.invoiceNumber,
      CustomerRef: { value: customerQboId },
      TxnDate: qboDate(invoice.invoiceDate),
      DueDate: qboDate(invoice.dueDate || invoice.invoiceDate),
      PrivateNote: invoice.notes || undefined,
      Line: lineItems.map((li: any) => ({
        DetailType: 'SalesItemLineDetail',
        Description: li.notes || li.description, // Use notes (description) if available, otherwise use item name
        Amount: toNumber(li.quantity) * toNumber(li.unitPrice),
        SalesItemLineDetail: {
          ItemRef: { value: serviceItemId },
          Qty: toNumber(li.quantity),
          UnitPrice: toNumber(li.unitPrice),
        },
      })),
    }

    // If we previously created a QBO Estimate, link the invoice to it so QBO treats this like a conversion.
    // This does not create any new entities; it only adds a relationship when the estimate exists.
    if (invoice.estimateId) {
      let estimateQboId = await getMappedQboId(session.integrationId, 'estimate', invoice.estimateId)
      if (!estimateQboId) {
        // Best-effort: ensure the estimate exists in QBO before creating the invoice, so QBO can link them.
        // This keeps the "estimate -> invoice" flow intact even if estimate sync ran later/failed previously.
        await syncEstimateToQuickBooks(tenantId, invoice.estimateId)
        estimateQboId = await getMappedQboId(session.integrationId, 'estimate', invoice.estimateId)
      }
      if (estimateQboId) {
        payload.LinkedTxn = [{ TxnId: estimateQboId, TxnType: 'Estimate' }]
      }
    }

    const created = await quickBooksService.createInvoice(
      session.accessToken,
      session.realmId,
      payload
    )
    const qboId = String(created?.Invoice?.Id || '')
    if (!qboId) throw new Error('QuickBooks did not return invoice id')

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        qboSyncId: qboId,
        qboSyncAt: new Date(),
      },
    })

    await logSync({
      integrationId: session.integrationId,
      type: 'invoice',
      action: 'create',
      status: 'success',
      entityId: invoice.id,
      qboId,
    })
  } catch (error: any) {
    await logSync({
      integrationId: session.integrationId,
      type: 'invoice',
      action: 'create',
      status: 'error',
      entityId: invoiceId,
      error: error?.message || 'QuickBooks invoice sync failed',
    })
  }
}

export async function syncPaymentToQuickBooks(tenantId: string, paymentId: string) {
  const session = await getQboSession(tenantId)
  if (!session) return
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: paymentId },
      include: {
        invoice: {
          include: {
            client: true,
          },
        },
      },
    })
    if (!payment || payment.invoice.tenantId !== tenantId) return

    const existingQboId = await getMappedQboId(session.integrationId, 'payment', payment.id)
    if (existingQboId) return

    let invoiceQboId = payment.invoice.qboSyncId
    if (!invoiceQboId) {
      await syncInvoiceToQuickBooks(tenantId, payment.invoice.id)
      const refreshed = await prisma.invoice.findUnique({
        where: { id: payment.invoice.id },
        select: { qboSyncId: true },
      })
      invoiceQboId = refreshed?.qboSyncId || null
    }
    if (!invoiceQboId) throw new Error('Unable to sync payment: local invoice has no QuickBooks id')

    const customerQboId = await ensureClientCustomer({
      tenantId,
      clientId: payment.invoice.clientId,
      accessToken: session.accessToken,
      realmId: session.realmId,
      integrationId: session.integrationId,
    })
    if (!customerQboId) throw new Error('Unable to resolve customer in QuickBooks')

    const amount = toNumber(payment.amount)
    const invoiceNumber = payment.invoice.invoiceNumber || payment.invoice.id
    const paymentNote = payment.reference || payment.notes || `Payment for Invoice ${invoiceNumber}`
    const payload = {
      CustomerRef: { value: customerQboId },
      TotalAmt: amount,
      TxnDate: qboDate(payment.processedAt || payment.createdAt),
      PrivateNote: paymentNote,
      Line: [
        {
          Amount: amount,
          LinkedTxn: [
            {
              TxnId: invoiceQboId,
              TxnType: 'Invoice',
            },
          ],
        },
      ],
    }

    const created = await quickBooksService.createPayment(
      session.accessToken,
      session.realmId,
      payload
    )
    const qboId = String(created?.Payment?.Id || '')
    if (!qboId) throw new Error('QuickBooks did not return payment id')

    await logSync({
      integrationId: session.integrationId,
      type: 'payment',
      action: 'create',
      status: 'success',
      entityId: payment.id,
      qboId,
    })
  } catch (error: any) {
    await logSync({
      integrationId: session.integrationId,
      type: 'payment',
      action: 'create',
      status: 'error',
      entityId: paymentId,
      error: error?.message || 'QuickBooks payment sync failed',
    })
  }
}

export async function syncVendorToQuickBooks(tenantId: string, vendorId: string) {
  const session = await getQboSession(tenantId)
  if (!session) return
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, tenantId },
      include: {
        contacts: {
          where: { isPrimary: true },
          take: 1,
        },
      },
    })
    if (!vendor) return

    const mappedId = await getMappedQboId(session.integrationId, 'vendor', vendor.id)
    const payload: any = {
      DisplayName: vendor.name,
      CompanyName: vendor.name,
      PrimaryEmailAddr: vendor.email ? { Address: vendor.email } : undefined,
      PrimaryPhone: vendor.phone ? { FreeFormNumber: vendor.phone } : undefined,
      WebAddr: vendor.website ? { URI: vendor.website } : undefined,
      BillAddr: vendor.billingStreet
        ? {
            Line1: vendor.billingStreet,
            City: vendor.billingCity || undefined,
            CountrySubDivisionCode: vendor.billingState || undefined,
            PostalCode: vendor.billingZip || undefined,
            Country: vendor.billingCountry || 'US',
          }
        : undefined,
    }

    if (mappedId) {
      const current = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        `/vendor/${mappedId}`
      )
      const syncToken = current?.Vendor?.SyncToken || '0'
      const updated = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        '/vendor?operation=update',
        'POST',
        { ...payload, Id: mappedId, SyncToken: syncToken, sparse: true }
      )
      const qboId = String(updated?.Vendor?.Id || mappedId)
      await logSync({
        integrationId: session.integrationId,
        type: 'vendor',
        action: 'update',
        status: 'success',
        entityId: vendor.id,
        qboId,
      })
      return
    }

    const existing = await findVendorByDisplayName(session.accessToken, session.realmId, vendor.name)
    if (existing?.Id) {
      await logSync({
        integrationId: session.integrationId,
        type: 'vendor',
        action: 'link',
        status: 'success',
        entityId: vendor.id,
        qboId: String(existing.Id),
      })
      return
    }

    const created = await quickBooksService.makeAPIRequest(
      session.accessToken,
      session.realmId,
      '/vendor',
      'POST',
      payload
    )
    const qboId = String(created?.Vendor?.Id || '')
    if (!qboId) throw new Error('QuickBooks did not return vendor id')
    await logSync({
      integrationId: session.integrationId,
      type: 'vendor',
      action: 'create',
      status: 'success',
      entityId: vendor.id,
      qboId,
    })
  } catch (error: any) {
    await logSync({
      integrationId: session.integrationId,
      type: 'vendor',
      action: 'create',
      status: 'error',
      entityId: vendorId,
      error: error?.message || 'QuickBooks vendor sync failed',
    })
  }
}

export async function syncPurchaseOrderToQuickBooks(tenantId: string, purchaseOrderId: string) {
  const session = await getQboSession(tenantId)
  if (!session) return
  try {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, tenantId },
      include: {
        vendorRef: true,
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
    if (!po || !po.vendorId || !po.vendorRef) return

    await syncVendorToQuickBooks(tenantId, po.vendorId)
    const vendorQboId = await getMappedQboId(session.integrationId, 'vendor', po.vendorId)
    if (!vendorQboId) throw new Error('Unable to resolve QuickBooks vendor id for purchase order')

    const expenseAccountId = await ensureExpenseAccount(session.accessToken, session.realmId)
    if (!expenseAccountId) throw new Error('Unable to resolve QuickBooks expense account')

    const lines = po.lineItems.length
      ? po.lineItems.map((li) => ({
          DetailType: 'AccountBasedExpenseLineDetail',
          Description: li.description,
          Amount: toNumber(li.total),
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: expenseAccountId },
            BillableStatus: 'NotBillable',
          },
        }))
      : [
          {
            DetailType: 'AccountBasedExpenseLineDetail',
            Description: po.vendor || 'Purchase Order',
            Amount: toNumber(po.total),
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: expenseAccountId },
              BillableStatus: 'NotBillable',
            },
          },
        ]

    const payload: any = {
      DocNumber: po.poNumber,
      VendorRef: { value: vendorQboId },
      TxnDate: qboDate(po.orderDate || po.createdAt),
      PrivateNote: `Trim Pro Purchase Order ${po.poNumber}`,
      Line: lines,
    }

    const mappedPoQboId = await getMappedQboId(session.integrationId, 'purchase_order', po.id)
    if (mappedPoQboId) {
      const current = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        `/purchaseorder/${mappedPoQboId}`
      )
      const syncToken = current?.PurchaseOrder?.SyncToken || '0'
      const updated = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        '/purchaseorder?operation=update',
        'POST',
        { ...payload, Id: mappedPoQboId, SyncToken: syncToken }
      )
      const qboId = String(updated?.PurchaseOrder?.Id || mappedPoQboId)
      await logSync({
        integrationId: session.integrationId,
        type: 'purchase_order',
        action: 'update',
        status: 'success',
        entityId: po.id,
        qboId,
      })
      return
    }

    const created = await quickBooksService.makeAPIRequest(
      session.accessToken,
      session.realmId,
      '/purchaseorder',
      'POST',
      payload
    )
    const qboId = String(created?.PurchaseOrder?.Id || '')
    if (!qboId) throw new Error('QuickBooks did not return purchase order id')
    await logSync({
      integrationId: session.integrationId,
      type: 'purchase_order',
      action: 'create',
      status: 'success',
      entityId: po.id,
      qboId,
    })
  } catch (error: any) {
    await logSync({
      integrationId: session.integrationId,
      type: 'purchase_order',
      action: 'create',
      status: 'error',
      entityId: purchaseOrderId,
      error: error?.message || 'QuickBooks purchase order sync failed',
    })
  }
}

export async function importQuickBooksCustomersAndPayments(
  tenantId: string,
  options?: { includePayments?: boolean; includeItems?: boolean; includeOpenInvoices?: boolean }
) {
  const session = await getQboSession(tenantId)
  if (!session) throw new Error('QuickBooks is not connected for this tenant.')
  const includePayments = Boolean(options?.includePayments)
  // Default: import items as well (matches "import all clients and items" request).
  const includeItems = options?.includeItems !== false
  const includeOpenInvoices = Boolean(options?.includeOpenInvoices)

  let importedClients = 0
  let importedSubClients = 0
  let importedOpenInvoices = 0
  let skippedOpenInvoices = 0
  let importedPayments = 0
  let skippedPayments = 0
  let importedItems = 0
  const errors: string[] = []

  // Import customers
  // Keep a local in-memory mapping so subcustomers can be linked even if the parent is on a later page.
  const qboCustomerIdToLocalClientId = new Map<string, string>()
  const pendingParentLinks: Array<{ childLocalId: string; parentQboId: string }> = []

  const existingClientMaps = await prisma.quickBooksSyncLog.findMany({
    where: {
      integrationId: session.integrationId,
      type: 'client',
      status: 'success',
      qboId: { not: null },
      entityId: { not: null },
    },
    select: { qboId: true, entityId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  // Filter out stale mappings (e.g., after a factory reset that wiped clients but preserved sync logs).
  const mappedClientIds = Array.from(
    new Set(existingClientMaps.map((r) => (r.entityId ? String(r.entityId) : null)).filter(Boolean) as string[])
  )
  const existingClients = mappedClientIds.length
    ? await prisma.client.findMany({
        where: { tenantId, id: { in: mappedClientIds } },
        select: { id: true },
      })
    : []
  const existingClientIdSet = new Set(existingClients.map((c) => c.id))

  for (const row of existingClientMaps) {
    if (!row.qboId || !row.entityId) continue
    const localId = String(row.entityId)
    if (!existingClientIdSet.has(localId)) continue
    qboCustomerIdToLocalClientId.set(String(row.qboId), localId)
  }

  for (let start = 1; start <= 10000; start += 1000) {
    const query = `select * from Customer startposition ${start} maxresults 1000`
    const res = await quickBooksService.query(session.accessToken, session.realmId, query)
    const customers = res?.QueryResponse?.Customer || []
    if (!customers.length) break

    const isSubcustomer = (c: any) => Boolean(c?.Job) || Boolean(c?.ParentRef?.value)

    const resolveOrImportParentClientId = async (parentQboId: string, childQboId: string): Promise<string | null> => {
      const normalizedParent = String(parentQboId || '').trim()
      if (!normalizedParent) return null
      if (normalizedParent === String(childQboId || '').trim()) return null

      const cached = qboCustomerIdToLocalClientId.get(normalizedParent)
      if (cached) return cached

      const existingMap = await prisma.quickBooksSyncLog.findFirst({
        where: {
          integrationId: session.integrationId,
          type: 'client',
          qboId: normalizedParent,
          status: 'success',
          entityId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
      })
      if (existingMap?.entityId) {
        qboCustomerIdToLocalClientId.set(normalizedParent, String(existingMap.entityId))
        return String(existingMap.entityId)
      }

      // Parent not imported yet; fetch parent customer by id and import it now.
      const parentRes = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        `/customer/${encodeURIComponent(normalizedParent)}`,
        'GET'
      )
      const parent = parentRes?.Customer || null
      if (!parent?.Id) return null

      const parentName = parent.DisplayName || parent.CompanyName || 'QuickBooks Client'
      const parentEmail = parent.PrimaryEmailAddr?.Address || null
      const parentPhone = parent.PrimaryPhone?.FreeFormNumber || null
      const parentCompanyName = parent.CompanyName || null

      const existingLocal = await prisma.client.findFirst({
        where: {
          tenantId,
          OR: [
            ...(parentEmail ? [{ email: { equals: String(parentEmail), mode: 'insensitive' as const } }] : []),
            { name: { equals: String(parentName), mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      })

      const created =
        existingLocal ||
        (await prisma.client.create({
          data: {
            tenantId,
            name: String(parentName),
            companyName: parentCompanyName ? String(parentCompanyName) : null,
            email: parentEmail ? String(parentEmail) : null,
            phone: parentPhone ? String(parentPhone) : null,
            notes: 'Imported from QuickBooks (parent auto-import during subclient import)',
            isActive: true,
          },
        }))

      await logSync({
        integrationId: session.integrationId,
        type: 'client',
        action: 'import',
        status: 'success',
        entityId: created.id,
        qboId: String(parent.Id),
        data: { parentQboId: null, qboJob: Boolean(parent?.Job) },
      })

      if (!existingLocal) importedClients += 1
      qboCustomerIdToLocalClientId.set(String(parent.Id), created.id)
      return created.id
    }

    const importOneCustomer = async (c: any) => {
      try {
        const qboId = String(c.Id || '')
        if (!qboId) return

        const existingMap = await prisma.quickBooksSyncLog.findFirst({
          where: {
            integrationId: session.integrationId,
            type: 'client',
            qboId,
            status: 'success',
            entityId: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        })
        if (existingMap?.entityId) {
          const localId = String(existingMap.entityId)
          const stillExists = await prisma.client.findFirst({
            where: { id: localId, tenantId },
            select: { id: true },
          })
          if (stillExists) {
            qboCustomerIdToLocalClientId.set(qboId, localId)
            return
          }
          // Stale sync log entry; continue importing.
        }

        const parentQboId = c?.ParentRef?.value ? String(c.ParentRef.value) : null
        const parentLocalId = parentQboId
          ? await resolveOrImportParentClientId(parentQboId, qboId)
          : null

        const name = c.DisplayName || c.CompanyName || 'QuickBooks Client'
        const email = c.PrimaryEmailAddr?.Address || null
        const phone = c.PrimaryPhone?.FreeFormNumber || null
        const companyName = c.CompanyName || null

        const local = await prisma.client.findFirst({
          where: {
            tenantId,
            OR: [
              ...(email ? [{ email: { equals: String(email), mode: 'insensitive' as const } }] : []),
              { name: { equals: String(name), mode: 'insensitive' } },
            ],
          },
          orderBy: { updatedAt: 'desc' },
        })

        const client =
          local ||
          (await prisma.client.create({
            data: {
              tenantId,
              parentId: parentLocalId,
              name: String(name),
              companyName: companyName ? String(companyName) : null,
              email: email ? String(email) : null,
              phone: phone ? String(phone) : null,
              notes: 'Imported from QuickBooks historical import',
              isActive: true,
            },
          }))

        // If this is a subcustomer and we found a parent, set it when the local client wasn't already parented.
        if (parentLocalId && client.parentId !== parentLocalId && client.id !== parentLocalId) {
          await prisma.client.update({
            where: { id: client.id },
            data: {
              parentId: client.parentId || parentLocalId,
            },
          })
        }

        await logSync({
          integrationId: session.integrationId,
          type: 'client',
          action: 'import',
          status: 'success',
          entityId: client.id,
          qboId,
          data: { parentQboId: parentQboId || null, qboJob: Boolean(c?.Job) },
        })
        qboCustomerIdToLocalClientId.set(qboId, client.id)
        if (!local) {
          importedClients += 1
          if (parentLocalId) importedSubClients += 1
        }

        // If we couldn't resolve the parent yet, record a pending link to be attempted after all pages are imported.
        if (parentQboId && !parentLocalId) {
          pendingParentLinks.push({ childLocalId: client.id, parentQboId: String(parentQboId) })
        }
      } catch (error: any) {
        errors.push(`Customer import failed: ${error?.message || 'Unknown error'}`)
      }
    }

    // Import parents first, then subcustomers/jobs.
    for (const c of customers.filter((c: any) => !isSubcustomer(c))) {
      await importOneCustomer(c)
    }
    for (const c of customers.filter((c: any) => isSubcustomer(c))) {
      await importOneCustomer(c)
    }
  }

  // Final pass: attach any subclients whose parents were imported later.
  for (const link of pendingParentLinks) {
    const parentLocalId = qboCustomerIdToLocalClientId.get(link.parentQboId)
    if (!parentLocalId) continue
    if (parentLocalId === link.childLocalId) continue
    try {
      const existing = await prisma.client.findFirst({
        where: { id: link.childLocalId, tenantId },
        select: { id: true, parentId: true },
      })
      if (!existing) continue
      if (existing.parentId) continue
      await prisma.client.update({
        where: { id: link.childLocalId },
        data: { parentId: parentLocalId },
      })
      importedSubClients += 1
    } catch {
      // best-effort
    }
  }

  // Import Items (products/services) when requested.
  for (let start = 1; includeItems && start <= 10000; start += 1000) {
    const query = `select * from Item startposition ${start} maxresults 1000`
    const res = await quickBooksService.query(session.accessToken, session.realmId, query)
    const items = res?.QueryResponse?.Item || []
    if (!items.length) break

    for (const it of items) {
      try {
        const qboId = String(it.Id || '')
        if (!qboId) continue

        const existingMap = await prisma.quickBooksSyncLog.findFirst({
          where: {
            integrationId: session.integrationId,
            type: 'item',
            qboId,
            status: 'success',
            entityId: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        })
        if (existingMap?.entityId) {
          const localId = String(existingMap.entityId)
          const stillExists = await prisma.item.findFirst({
            where: { id: localId, tenantId },
            select: { id: true },
          })
          if (stillExists) continue
          // Stale sync log entry; continue importing.
        }

        const name = String(it.Name || it.FullyQualifiedName || 'QuickBooks Item').trim()
        const sku = it.Sku ? String(it.Sku).trim() : null
        // Some QBO item setups use SalesDesc/PurchaseDesc instead of Description.
        const description = it.Description
          ? String(it.Description)
          : it.SalesDesc
            ? String(it.SalesDesc)
            : it.PurchaseDesc
              ? String(it.PurchaseDesc)
              : null
        const active = typeof it.Active === 'boolean' ? it.Active : true
        const taxable = typeof it.Taxable === 'boolean' ? it.Taxable : true

        // QuickBooks item Type values include: Service, Inventory, NonInventory, Category, etc.
        const qboType = String(it.Type || '').toLowerCase()
        const type =
          qboType === 'service'
            ? 'SERVICE'
            : qboType === 'inventory'
              ? 'MATERIAL'
              : 'PRODUCT'

        const unitPrice = toNumber(it.UnitPrice)
        const purchaseCost = it.PurchaseCost != null ? toNumber(it.PurchaseCost) : null

        const local = await prisma.item.findFirst({
          where: {
            tenantId,
            OR: [
              ...(sku ? [{ sku: { equals: sku, mode: 'insensitive' as const } }] : []),
              { name: { equals: name, mode: 'insensitive' } },
            ],
          },
          orderBy: { updatedAt: 'desc' },
        })

        const item =
          local ||
          (await prisma.item.create({
            data: {
              tenantId,
              name,
              sku,
              type: type as any,
              kind: 'SINGLE',
              description,
              unit: 'ea',
              defaultUnitPrice: unitPrice,
              defaultUnitCost: purchaseCost,
              taxable,
              isActive: active,
              notes: 'Imported from QuickBooks historical import',
            },
          }))

        await logSync({
          integrationId: session.integrationId,
          type: 'item',
          action: 'import',
          status: 'success',
          entityId: item.id,
          qboId,
          data: { qboType: it.Type || null },
        })
        importedItems += local ? 0 : 1
      } catch (error: any) {
        errors.push(`Item import failed: ${error?.message || 'Unknown error'}`)
      }
    }
  }

  // Import open/unpaid invoices when requested.
  // - Must run after customers import so CustomerRef can be mapped to local clientId.
  // - Uses QB invoice ids in `invoice.qboSyncId` to avoid duplicates.
  for (let start = 1; includeOpenInvoices && start <= 10000; start += 1000) {
    // QBOQL is picky about which fields support comparison operators across objects.
    // Query invoices broadly and filter open/unpaid locally by Balance > 0.
    const query = `select * from Invoice startposition ${start} maxresults 1000`
    const res = await quickBooksService.query(session.accessToken, session.realmId, query)
    const invoices = res?.QueryResponse?.Invoice || []
    if (!invoices.length) break

    for (const inv of invoices) {
      try {
        const qboInvoiceId = String(inv.Id || '')
        if (!qboInvoiceId) continue

        const balance = toNumber(inv.Balance)
        // Skip paid/zero-balance invoices; this importer is specifically for open/unpaid.
        if (balance <= 0) continue

        const exists = await prisma.invoice.findFirst({
          where: { tenantId, qboSyncId: qboInvoiceId },
          select: { id: true },
        })
        if (exists) continue

        const customerQboId = inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : ''
        const clientId = customerQboId ? qboCustomerIdToLocalClientId.get(customerQboId) || null : null
        if (!clientId) {
          skippedOpenInvoices += 1
          errors.push(`Invoice import skipped (missing client mapping): QB invoice ${qboInvoiceId}`)
          continue
        }

        const docNumber = String(inv.DocNumber || '').trim()
        const invoiceNumberBase = docNumber ? `QB-${docNumber}` : `QB-${qboInvoiceId}`
        let invoiceNumber = invoiceNumberBase

        // Guard global uniqueness on invoiceNumber
        const collision = await prisma.invoice.findFirst({
          where: { invoiceNumber },
          select: { id: true },
        })
        if (collision) {
          invoiceNumber = `${invoiceNumberBase}-${qboInvoiceId.slice(-6)}`
        }

        const totalAmt = toNumber(inv.TotalAmt)
        const taxAmount = toNumber(inv?.TxnTaxDetail?.TotalTax)
        const subtotal = Math.max(0, totalAmt - taxAmount)
        const paidAmount = Math.max(0, totalAmt - balance)

        const txnDateRaw = inv.TxnDate ? String(inv.TxnDate) : null
        const dueDateRaw = inv.DueDate ? String(inv.DueDate) : null
        const invoiceDate = txnDateRaw ? new Date(`${txnDateRaw}T00:00:00.000Z`) : new Date()
        const dueDate = dueDateRaw ? new Date(`${dueDateRaw}T00:00:00.000Z`) : null

        const now = new Date()
        const isOverdue = dueDate ? dueDate.getTime() < now.getTime() && balance > 0 : false
        const status = balance <= 0 ? 'PAID' : isOverdue ? 'OVERDUE' : 'SENT'

        const title = `QuickBooks Invoice ${docNumber || qboInvoiceId}`
        const notes = inv.PrivateNote ? String(inv.PrivateNote) : 'Imported from QuickBooks (open invoice import)'

        // Build line items; fall back to one summary line if QBO doesn't include usable lines.
        const qboLines = Array.isArray(inv.Line) ? inv.Line : []
        const lineRows = qboLines
          .filter((l: any) => l && typeof l === 'object')
          .filter((l: any) => {
            const dt = String(l.DetailType || '')
            return dt !== 'SubTotalLineDetail' && dt !== 'DescriptionOnly'
          })
          .map((l: any, idx: number) => {
            const amount = toNumber(l.Amount)
            if (!amount) return null
            const qty = toNumber(l?.SalesItemLineDetail?.Qty) || 1
            const unitPrice =
              toNumber(l?.SalesItemLineDetail?.UnitPrice) || (qty ? amount / qty : amount)
            
            // Extract item name from ItemRef
            const itemName = String(l?.SalesItemLineDetail?.ItemRef?.name || '') || 
                            String(l?.SalesItemLineDetail?.ItemRef?.value || '') || 
                            ''
            
            // Extract description from Description field
            const description = String(l.Description || '')
            
            // Use item name as description if no description provided, fallback to line number
            const finalDescription = itemName || description || `QuickBooks line ${idx + 1}`
            const finalNotes = description && itemName ? description : null

            return {
              description: finalDescription.slice(0, 500),
              notes: finalNotes ? finalNotes.slice(0, 2000) : null,
              quantity: qty,
              unitPrice,
              total: amount,
              sortOrder: idx,
              taxable: true,
            }
          })
          .filter(Boolean) as Array<{
          description: string
          notes: string | null
          quantity: number
          unitPrice: number
          total: number
          sortOrder: number
          taxable: boolean
        }>

        const linesToInsert =
          lineRows.length > 0
            ? lineRows
            : [
                {
                  description: 'Imported from QuickBooks',
                  quantity: 1,
                  unitPrice: subtotal || totalAmt || 0,
                  total: subtotal || totalAmt || 0,
                  sortOrder: 0,
                  taxable: true,
                },
              ]

        const created = await prisma.invoice.create({
          data: {
            tenantId,
            clientId,
            jobId: null,
            estimateId: null,
            invoiceNumber,
            title,
            status: status as any,
            subtotal,
            taxRate: 0,
            taxAmount,
            discount: 0,
            total: totalAmt,
            paidAmount,
            balance,
            invoiceDate,
            dueDate,
            sentAt: invoiceDate,
            notes,
            terms: null,
            memo: null,
            paymentToken: crypto.randomBytes(20).toString('hex'),
            qboAchEnabled: true,
            qboSyncId: qboInvoiceId,
            qboSyncAt: new Date(),
          },
        })

        await prisma.invoiceLineItem.createMany({
          data: linesToInsert.map((l) => ({
            invoiceId: created.id,
            groupId: null,
            sourceItemId: null,
            sourceBundleId: null,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            unitCost: null,
            total: l.total,
            sortOrder: l.sortOrder,
            notes: l.notes || null,
            vendorId: null,
            taxable: l.taxable,
            taxRate: null,
          })),
        })

        await logSync({
          integrationId: session.integrationId,
          type: 'invoice',
          action: 'import',
          status: 'success',
          entityId: created.id,
          qboId: qboInvoiceId,
          data: { docNumber: docNumber || null, balance },
        })

        importedOpenInvoices += 1
      } catch (error: any) {
        errors.push(`Invoice import failed: ${error?.message || 'Unknown error'}`)
      }
    }
  }

  // Import payments only when explicitly requested.
  for (let start = 1; includePayments && start <= 10000; start += 1000) {
    const query = `select * from Payment startposition ${start} maxresults 1000`
    const res = await quickBooksService.query(session.accessToken, session.realmId, query)
    const payments = res?.QueryResponse?.Payment || []
    if (!payments.length) break

    for (const p of payments) {
      try {
        const qboPaymentId = String(p.Id || '')
        if (!qboPaymentId) continue

        const already = await prisma.quickBooksSyncLog.findFirst({
          where: {
            integrationId: session.integrationId,
            type: 'payment',
            qboId: qboPaymentId,
            status: 'success',
          },
          orderBy: { createdAt: 'desc' },
        })
        if (already) continue

        const linked = Array.isArray(p.Line)
          ? p.Line.flatMap((line: any) => line.LinkedTxn || [])
          : []
        const linkedInvoice = linked.find((t: any) => String(t?.TxnType || '').toLowerCase() === 'invoice')
        const linkedInvoiceQboId = linkedInvoice?.TxnId ? String(linkedInvoice.TxnId) : null
        if (!linkedInvoiceQboId) {
          skippedPayments += 1
          continue
        }

        const localInvoice = await prisma.invoice.findFirst({
          where: {
            tenantId,
            qboSyncId: linkedInvoiceQboId,
          },
        })
        if (!localInvoice) {
          skippedPayments += 1
          continue
        }

        const reference = `qb-pay-${qboPaymentId}`
        const existsPayment = await prisma.payment.findFirst({
          where: {
            OR: [{ reference }, { solaTransactionId: qboPaymentId }],
          },
        })
        if (existsPayment) {
          await logSync({
            integrationId: session.integrationId,
            type: 'payment',
            action: 'import',
            status: 'success',
            entityId: existsPayment.id,
            qboId: qboPaymentId,
          })
          continue
        }

        const amount = toNumber(p.TotalAmt)
        const createdPayment = await prisma.payment.create({
          data: {
            invoiceId: localInvoice.id,
            amount,
            status: 'COMPLETED',
            method: 'OTHER',
            reference,
            processedAt: p.TxnDate ? new Date(`${p.TxnDate}T00:00:00.000Z`) : new Date(),
            notes: 'Imported from QuickBooks historical import',
          },
        })

        const newPaidAmount = toNumber(localInvoice.paidAmount) + amount
        const newBalance = Math.max(0, toNumber(localInvoice.total) - newPaidAmount)
        await prisma.invoice.update({
          where: { id: localInvoice.id },
          data: {
            paidAmount: newPaidAmount,
            balance: newBalance,
            status: newBalance <= 0 ? 'PAID' : 'PARTIAL',
            paidAt: newBalance <= 0 ? new Date() : localInvoice.paidAt,
          },
        })

        await logSync({
          integrationId: session.integrationId,
          type: 'payment',
          action: 'import',
          status: 'success',
          entityId: createdPayment.id,
          qboId: qboPaymentId,
        })
        importedPayments += 1
      } catch (error: any) {
        errors.push(`Payment import failed: ${error?.message || 'Unknown error'}`)
      }
    }
  }

  await prisma.quickBooksIntegration.update({
    where: { tenantId },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: errors.length ? 'partial' : 'success',
      lastSyncError: errors.length ? errors.slice(0, 5).join('; ') : null,
    },
  })

  return {
    importedClients,
    importedSubClients,
    importedItems,
    importedOpenInvoices,
    skippedOpenInvoices,
    importedPayments,
    skippedPayments,
    errors: errors.slice(0, 20),
  }
}

