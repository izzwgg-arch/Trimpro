import { prisma } from '@/lib/prisma'
import { quickBooksService } from '@/lib/services/quickbooks'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { encryptSecrets } from '@/lib/integrations/secrets'
import { getPrimaryEmail } from '@/lib/email'
import crypto from 'crypto'

const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000
const PAYMENT_METHOD_CACHE_TTL_MS = 30 * 60 * 1000

type CachedLookup = {
  id: string
  expiresAt: number
}

const customerLookupCache = new Map<string, CachedLookup>()
const vendorLookupCache = new Map<string, CachedLookup>()
const paymentMethodLookupCache = new Map<string, CachedLookup>()

function readCachedLookup(cache: Map<string, CachedLookup>, key: string): string | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return hit.id
}

function writeCachedLookup(cache: Map<string, CachedLookup>, key: string, id: string, ttlMs: number) {
  cache.set(key, { id, expiresAt: Date.now() + ttlMs })
}

function makeLookupCacheKey(parts: Array<string | null | undefined>) {
  return parts.map((part) => String(part || '').trim().toLowerCase()).join('|')
}

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

/** Intuit recommends minorversion on reads so nested line structures match the UI. */
const QBO_ESTIMATE_READ_MINOR_VERSION = '75'

export function qboEstimateReadEndpoint(qboId: string) {
  return `/estimate/${encodeURIComponent(qboId)}?minorversion=${QBO_ESTIMATE_READ_MINOR_VERSION}`
}

function getErrorMessage(error: any): string {
  return String(error?.message || error || '')
}

function isQboMissingOrDeletedEntityError(error: any): boolean {
  const msg = getErrorMessage(error).toLowerCase()
  return (
    msg.includes('has been deleted') ||
    msg.includes('made inactive') ||
    msg.includes('object not found') ||
    msg.includes('not found') ||
    msg.includes('code=610') ||
    msg.includes('status=404')
  )
}

function isQboDeletedListReferenceError(error: any): boolean {
  const msg = getErrorMessage(error).toLowerCase()
  return msg.includes('cannot modify a list element that has been deleted')
}

function isQboDuplicateNameError(error: any): boolean {
  const msg = getErrorMessage(error).toLowerCase()
  return msg.includes('duplicate name exists') || msg.includes('code=6240') || msg.includes('the name supplied already exists')
}

function invalidateCustomerLookupCache(realmId: string, names: Array<string | null | undefined>) {
  for (const name of Array.from(new Set(names.map((value) => String(value || '').trim()).filter(Boolean)))) {
    customerLookupCache.delete(makeLookupCacheKey(['customer', realmId, name]))
  }
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

const QBO_SESSION_UNAVAILABLE_MSG =
  'QuickBooks session unavailable (not connected, missing realm, or token refresh failed). Reconnect in Settings → Integrations.'

/** When getQboSession returns null, record why document sync did not run (avoids silent no-ops). */
async function logQboSessionUnavailable(
  tenantId: string,
  type: SyncType,
  entityId: string,
  message: string = QBO_SESSION_UNAVAILABLE_MSG
) {
  const integration = await prisma.quickBooksIntegration.findUnique({
    where: { tenantId },
    select: { id: true },
  })
  if (!integration?.id) return
  await logSync({
    integrationId: integration.id,
    type,
    action: 'skip',
    status: 'error',
    entityId,
    error: message,
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
      const refreshed = await quickBooksService.refreshAccessToken(
        refreshToken,
        clientId || undefined,
        clientSecret || undefined,
        {
          tenantId,
          entityType: 'oauth_token',
          triggerSource: 'qbo_sync_session_refresh',
        }
      )
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
    // Cached QBO reference IDs — populated lazily and persisted to avoid
    // repeated "query by name" API calls on every sync.
    serviceItemId: integration.serviceItemId || null,
    cachedExpenseAccountId: integration.cachedExpenseAccountId || null,
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

async function getMappedLocalEntityId(integrationId: string, type: SyncType, qboId: string) {
  const row = await prisma.quickBooksSyncLog.findFirst({
    where: {
      integrationId,
      type,
      qboId,
      status: 'success',
      entityId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true },
  })
  return row?.entityId ? String(row.entityId) : null
}

async function getExistingMappedEstimateSummary(params: {
  integrationId: string
  tenantId: string
  qboEstimateId: string
}) {
  const mappedEstimateId = await getMappedLocalEntityId(
    params.integrationId,
    'estimate',
    params.qboEstimateId
  )
  if (!mappedEstimateId) return null

  const estimate = await prisma.estimate.findFirst({
    where: {
      id: mappedEstimateId,
      tenantId: params.tenantId,
    },
    select: {
      id: true,
      estimateNumber: true,
      title: true,
      status: true,
      total: true,
      client: {
        select: {
          id: true,
          name: true,
          companyName: true,
        },
      },
      _count: {
        select: {
          lineItems: true,
        },
      },
    },
  })

  if (!estimate) return null

  return {
    id: estimate.id,
    estimateNumber: estimate.estimateNumber,
    title: estimate.title,
    status: estimate.status,
    total: Number(estimate.total || 0),
    lineItemCount: estimate._count.lineItems,
    client: estimate.client
      ? {
          id: estimate.client.id,
          name: estimate.client.name,
          companyName: estimate.client.companyName,
        }
      : null,
  }
}

/**
 * QBO often emits each PDF "sub-row" as its own DescriptionOnly line after a single SalesItem line.
 * Merge those into the neighboring sales/subtotal/group line so import can see one multi-line Description.
 */
function flattenEmbeddedDescriptionOnlyLines(qboLines: any[]): any[] {
  const pending: string[] = []
  const out: any[] = []

  const appendDesc = (target: any, texts: string[]) => {
    if (!texts.length) return
    const add = texts.join('\n')
    const cur = String(target.Description || '').trim()
    target.Description = cur ? `${cur}\n${add}` : add
  }

  for (const line of qboLines) {
    if (!line || typeof line !== 'object') continue
    const dt = String(line.DetailType || '')
    if (
      dt === 'DescriptionOnly' ||
      dt === 'DescriptionOnlyLineDetail' ||
      dt === 'DescriptionLineDetail'
    ) {
      const d = String(line.Description || '').trim()
      if (d) pending.push(d)
      continue
    }

    if (out.length === 0 && pending.length) {
      const merged = { ...line }
      appendDesc(merged, pending)
      pending.length = 0
      out.push(merged)
      continue
    }

    if (out.length > 0 && pending.length) {
      appendDesc(out[out.length - 1], pending)
      pending.length = 0
    }

    out.push({ ...line })
  }

  if (pending.length && out.length) {
    appendDesc(out[out.length - 1], pending)
    pending.length = 0
  }

  return out
}

function inferEstimateStatusFromQuickBooks(qboEstimate: any): 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' {
  const txnStatus = String(qboEstimate?.TxnStatus || '').trim().toLowerCase()
  const emailStatus = String(qboEstimate?.EmailStatus || '').trim().toLowerCase()
  const expirationDateRaw = qboEstimate?.ExpirationDate ? String(qboEstimate.ExpirationDate) : null
  const expirationDate = expirationDateRaw ? new Date(`${expirationDateRaw}T00:00:00.000Z`) : null

  if (txnStatus.includes('accepted') || qboEstimate?.AcceptedDate || qboEstimate?.AcceptedBy) return 'ACCEPTED'
  if (txnStatus.includes('reject')) return 'REJECTED'
  if (expirationDate && !Number.isNaN(expirationDate.getTime()) && expirationDate.getTime() < Date.now()) return 'EXPIRED'
  if (txnStatus.includes('view')) return 'VIEWED'
  if (txnStatus.includes('sent') || txnStatus.includes('pending') || emailStatus === 'emailsent') return 'SENT'
  return 'DRAFT'
}

function buildImportedEstimateLineRows(qboEstimate: any) {
  const rawLines = Array.isArray(qboEstimate?.Line) ? qboEstimate.Line : []
  const qboLines = flattenEmbeddedDescriptionOnlyLines(rawLines)
  let detectedDiscount = 0
  // Track running sum for subtotal rows
  let runningSinceLastSubtotal = 0
  // Global sort order counter so sub-items within groups get unique positions
  let sortCounter = 0

  /**
   * QBO often returns a bundle as one SalesItemLineDetail with many detail rows in Description
   * (newline-separated). When parsed line totals match the QBO line Amount, expand into rows.
   */
  function tryExpandBundledDescriptionSalesLine(line: any): any[] | null {
    const amount = toNumber(line.Amount)
    if (!amount) return null
    let fullDesc = String(line.Description || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\t/g, ' ')
    if (!fullDesc.includes('\n')) return null

    const rawDescLines = fullDesc
      .split('\n')
      .map((l) => l.trim().replace(/\s+/g, ' '))
      .filter(Boolean)

    if (rawDescLines.length < 2) return null

    const parseMoneyToken = (s: string) => {
      const n = parseFloat(String(s).replace(/,/g, '').replace(/^\$/, '').trim())
      return Number.isFinite(n) ? n : 0
    }

    const tryParseDetailLine = (text: string) => {
      if (/^(qty|quantity|rate|amount|description)\b/i.test(text) && text.length < 48) return null
      // Optional "x" after quantity (e.g. "21 x Door ...")
      const m = text.match(
        /^(\d+(?:\.\d+)?)\s*x?\s+(.+?)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/i,
      )
      if (!m) return null
      const qty = parseFloat(m[1])
      const desc = m[2].trim()
      const unitPrice = parseMoneyToken(m[3])
      const total = parseMoneyToken(m[4])
      if (!(qty > 0) || !(total > 0)) return null
      const implied = qty * unitPrice
      if (Math.abs(implied - total) > Math.max(total * 0.12, 2)) return null
      return { qty, desc, unitPrice, total }
    }

    let sectionHeading: string | null = null
    const parsed: Array<{ qty: number; desc: string; unitPrice: number; total: number }> = []
    for (const text of rawDescLines) {
      const row = tryParseDetailLine(text)
      if (row) {
        parsed.push(row)
      } else if (parsed.length === 0) {
        sectionHeading = text.slice(0, 500)
      }
    }

    if (parsed.length === 0) return null

    const sumParsed = parsed.reduce((s, p) => s + p.total, 0)
    const relErr = Math.abs(sumParsed - amount) / Math.max(amount, 1)
    if (relErr > 0.035 && Math.abs(sumParsed - amount) > 1.5) return null

    const itemName =
      String(line?.SalesItemLineDetail?.ItemRef?.name || '') ||
      String(line?.SalesItemLineDetail?.ItemRef?.value || '') ||
      ''

    return parsed.map((p, i) => {
      runningSinceLastSubtotal += p.total
      const noteParts: string[] = []
      if (i === 0 && sectionHeading) noteParts.push(sectionHeading)
      if (itemName && itemName !== p.desc) noteParts.push(itemName)
      const notes = noteParts.length ? noteParts.join(' — ').slice(0, 2000) : null
      return {
        description: p.desc.slice(0, 500),
        notes,
        quantity: p.qty,
        unitPrice: p.unitPrice,
        total: p.total,
        sortOrder: sortCounter++,
        taxable: true,
        isSubtotal: false,
      }
    })
  }

  /** Build a single SalesItemLineDetail row from a QBO line object */
  function buildSalesRow(line: any): any | null {
    const amount = toNumber(line.Amount)
    if (!amount) return null
    const qty = toNumber(line?.SalesItemLineDetail?.Qty) || 1
    const unitPrice =
      toNumber(line?.SalesItemLineDetail?.UnitPrice) || (qty ? amount / qty : amount)
    const itemName =
      String(line?.SalesItemLineDetail?.ItemRef?.name || '') ||
      String(line?.SalesItemLineDetail?.ItemRef?.value || '') ||
      ''
    const description = String(line.Description || '')
    const finalDescription = (itemName || description || 'QuickBooks item').slice(0, 500)
    const finalNotes =
      description && itemName && description !== itemName ? description.slice(0, 2000) : null
    runningSinceLastSubtotal += amount
    return {
      description: finalDescription,
      notes: finalNotes,
      quantity: qty,
      unitPrice,
      total: amount,
      sortOrder: sortCounter++,
      taxable: true,
      isSubtotal: false,
    }
  }

  const lineRows = qboLines
    .filter((line: any) => line && typeof line === 'object')
    .flatMap((line: any) => {
      const detailType = String(line.DetailType || '')
      const amount = toNumber(line.Amount)

      if (detailType === 'DiscountLineDetail') {
        detectedDiscount += Math.abs(amount)
        return []
      }

      // Preserve SubTotalLineDetail rows so the import matches QBO structure exactly
      if (detailType === 'SubTotalLineDetail') {
        // Use the QBO-provided amount (sum of items above), or fall back to running sum
        const subtotalAmt = amount > 0 ? amount : runningSinceLastSubtotal
        runningSinceLastSubtotal = 0 // reset for next segment
        return [
          {
            description: 'Subtotal',
            notes: null,
            quantity: 0,
            unitPrice: 0,
            total: subtotalAmt,
            sortOrder: sortCounter++,
            taxable: false,
            isSubtotal: true,
          },
        ]
      }

      // GroupLineDetail = QBO bundle/group: expand all sub-items then add a subtotal row
      const nestedGroupLines = Array.isArray(line.GroupLineDetail?.Line) ? line.GroupLineDetail.Line : []
      if (detailType === 'GroupLineDetail' || nestedGroupLines.length > 0) {
        const subLines = flattenEmbeddedDescriptionOnlyLines(nestedGroupLines)
        const results: any[] = []
        for (const subLine of subLines) {
          const row = buildSalesRow(subLine)
          if (row) results.push(row)
        }
        if (results.length > 0) {
          // Add a subtotal row after the group items to mirror QBO's visual grouping
          const groupTotal = amount > 0 ? amount : runningSinceLastSubtotal
          results.push({
            description: 'Subtotal',
            notes: null,
            quantity: 0,
            unitPrice: 0,
            total: groupTotal,
            sortOrder: sortCounter++,
            taxable: false,
            isSubtotal: true,
          })
          runningSinceLastSubtotal = 0
        }
        return results
      }

      // Skip description-only lines (section headers with no amount)
      if (
        detailType === 'DescriptionOnly' ||
        detailType === 'DescriptionOnlyLineDetail' ||
        detailType === 'DescriptionLineDetail'
      ) {
        return []
      }

      if (!amount) return []

      const expanded = tryExpandBundledDescriptionSalesLine(line)
      if (expanded && expanded.length > 0) return expanded

      const row = buildSalesRow(line)
      return row ? [row] : []
    })

  const totalAmt = toNumber(qboEstimate?.TotalAmt)
  const taxAmount = toNumber(qboEstimate?.TxnTaxDetail?.TotalTax)
  // Only sum regular (non-subtotal) rows for the estimate subtotal field
  const subtotalFromLines = lineRows
    .filter((l: any) => !l.isSubtotal)
    .reduce((sum: number, line: any) => sum + toNumber(line.total), 0)
  const computedDiscount = Math.max(0, subtotalFromLines + taxAmount - totalAmt)

  return {
    lineRows:
      lineRows.length > 0
        ? lineRows
        : [
            {
              description: 'Imported from QuickBooks',
              notes: null,
              quantity: 1,
              unitPrice: Math.max(0, totalAmt - taxAmount),
              total: Math.max(0, totalAmt - taxAmount),
              sortOrder: 0,
              taxable: true,
              isSubtotal: false,
            },
          ],
    subtotal: subtotalFromLines > 0 ? subtotalFromLines : Math.max(0, totalAmt - taxAmount),
    taxAmount,
    discount: detectedDiscount > 0 ? detectedDiscount : computedDiscount,
    totalAmt,
  }
}

async function allocateImportedEstimateNumber(qboEstimate: any) {
  const rawDocNumber = String(qboEstimate?.DocNumber || '').trim()
  const rawQboId = String(qboEstimate?.Id || '').trim()
  const base = rawDocNumber ? `QB-EST-${rawDocNumber}` : `QB-EST-${rawQboId}`

  let candidate = base
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const collision = await prisma.estimate.findFirst({
      where: {
        estimateNumber: candidate,
      },
      select: { id: true },
    })
    if (!collision) return candidate
    candidate = `${base}-${attempt + 1}`
  }

  throw new Error('Unable to allocate an estimate number for the imported QuickBooks estimate.')
}

export async function importQuickBooksEstimateById(tenantId: string, qboEstimateId: string) {
  const normalizedEstimateId = String(qboEstimateId || '').trim()
  if (!/^\d+$/.test(normalizedEstimateId)) {
    throw new Error('QuickBooks estimate ID must be a numeric value.')
  }

  const session = await getQboSession(tenantId)
  if (!session) throw new Error('QuickBooks is not connected for this tenant.')

  const existingEstimate = await getExistingMappedEstimateSummary({
    integrationId: session.integrationId,
    tenantId,
    qboEstimateId: normalizedEstimateId,
  })

  if (existingEstimate) {
    await logSync({
      integrationId: session.integrationId,
      type: 'estimate',
      action: 'import',
      status: 'conflict',
      entityId: existingEstimate.id,
      qboId: normalizedEstimateId,
      error: 'Estimate already imported',
    })
    return {
      alreadyImported: true,
      estimate: existingEstimate,
    }
  }

  const qboResponse = await quickBooksService.makeAPIRequest(
    session.accessToken,
    session.realmId,
    qboEstimateReadEndpoint(normalizedEstimateId),
    'GET',
    undefined,
    {
      tenantId,
      entityType: 'estimate',
      entityId: normalizedEstimateId,
      triggerSource: 'manual_estimate_import_by_id',
    }
  )

  const qboEstimate = qboResponse?.Estimate
  if (!qboEstimate?.Id) {
    throw new Error('QuickBooks estimate not found.')
  }

  const customerQboId = qboEstimate?.CustomerRef?.value ? String(qboEstimate.CustomerRef.value).trim() : ''
  const customerDisplayName = String(qboEstimate?.CustomerRef?.name || '').trim()

  let clientId: string | null = null
  let createdPlaceholderClient: { id: string; name: string } | null = null

  if (customerQboId) {
    const mappedClientId = await getMappedLocalEntityId(session.integrationId, 'client', customerQboId)
    if (mappedClientId) {
      const existingClient = await prisma.client.findFirst({
        where: { id: mappedClientId, tenantId },
        select: { id: true },
      })
      clientId = existingClient?.id || null
    }

    if (!clientId) {
      const placeholderClient = await prisma.client.create({
        data: {
          tenantId,
          name: customerDisplayName || `QuickBooks Client ${customerQboId}`,
          companyName: null,
          email: null,
          phone: null,
          notes: `Imported from QuickBooks estimate ${normalizedEstimateId} (client placeholder).`,
          isActive: true,
        },
      })

      await logSync({
        integrationId: session.integrationId,
        type: 'client',
        action: 'import',
        status: 'success',
        entityId: placeholderClient.id,
        qboId: customerQboId,
        data: {
          source: 'manual_estimate_import_placeholder',
          estimateQboId: normalizedEstimateId,
        },
      })

      clientId = placeholderClient.id
      createdPlaceholderClient = {
        id: placeholderClient.id,
        name: placeholderClient.name,
      }
    }
  }

  const { lineRows, subtotal, taxAmount, discount, totalAmt } = buildImportedEstimateLineRows(qboEstimate)
  const estimateNumber = await allocateImportedEstimateNumber(qboEstimate)
  const validUntilRaw = qboEstimate?.ExpirationDate ? String(qboEstimate.ExpirationDate) : null
  const txnDateRaw = qboEstimate?.TxnDate ? String(qboEstimate.TxnDate) : null
  const acceptedAtRaw = qboEstimate?.AcceptedDate ? String(qboEstimate.AcceptedDate) : null
  const validUntil = validUntilRaw ? new Date(`${validUntilRaw}T00:00:00.000Z`) : null
  const sentAt = txnDateRaw ? new Date(`${txnDateRaw}T00:00:00.000Z`) : null
  const acceptedAt = acceptedAtRaw ? new Date(`${acceptedAtRaw}T00:00:00.000Z`) : null
  const titleBase = String(qboEstimate?.CustomerMemo?.value || '').trim()
  const title =
    titleBase ||
    (qboEstimate?.DocNumber ? `QuickBooks Estimate ${String(qboEstimate.DocNumber).trim()}` : `QuickBooks Estimate ${normalizedEstimateId}`)

  const importedEstimate = await prisma.estimate.create({
    data: {
      tenantId,
      clientId,
      leadId: null,
      jobId: null,
      estimateNumber,
      title: title.slice(0, 255),
      jobSiteAddress: null,
      status: inferEstimateStatusFromQuickBooks(qboEstimate),
      subtotal,
      taxRate: 0,
      taxAmount,
      discount,
      total: totalAmt || Math.max(0, subtotal - discount + taxAmount),
      validUntil,
      sentAt,
      acceptedAt,
      notes: qboEstimate?.PrivateNote ? String(qboEstimate.PrivateNote) : 'Imported from QuickBooks estimate import by ID.',
      isNotesVisibleToClient: true,
      terms: null,
      createdById: null,
    },
    select: {
      id: true,
      estimateNumber: true,
      title: true,
      status: true,
      total: true,
      client: {
        select: {
          id: true,
          name: true,
          companyName: true,
        },
      },
    },
  })

  await prisma.estimateLineItem.createMany({
    data: lineRows.map((line: any) => ({
      estimateId: importedEstimate.id,
      groupId: null,
      sourceItemId: null,
      sourceBundleId: null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitCost: null,
      total: line.total,
      sortOrder: line.sortOrder,
      isVisibleToClient: true,
      showDescriptionToCustomer: true,
      showCostToCustomer: false,
      showPriceToCustomer: true,
      showTaxToCustomer: true,
      showNotesToCustomer: false,
      notes: line.notes,
      vendorId: null,
      taxable: line.taxable,
      taxRate: null,
      isSubtotal: line.isSubtotal === true,
    })),
  })

  await logSync({
    integrationId: session.integrationId,
    type: 'estimate',
    action: 'import',
    status: 'success',
    entityId: importedEstimate.id,
    qboId: normalizedEstimateId,
    data: {
      docNumber: qboEstimate?.DocNumber ? String(qboEstimate.DocNumber) : null,
      placeholderClientCreated: Boolean(createdPlaceholderClient),
    },
  })

  return {
    alreadyImported: false,
    estimate: {
      id: importedEstimate.id,
      estimateNumber: importedEstimate.estimateNumber,
      title: importedEstimate.title,
      status: importedEstimate.status,
      total: Number(importedEstimate.total || 0),
      lineItemCount: lineRows.length,
      client: importedEstimate.client
        ? {
            id: importedEstimate.client.id,
            name: importedEstimate.client.name,
            companyName: importedEstimate.client.companyName,
          }
        : null,
    },
    placeholderClientCreated: Boolean(createdPlaceholderClient),
    placeholderClient: createdPlaceholderClient,
  }
}

export async function reimportEstimateLines(tenantId: string, estimateId: string) {
  const session = await getQboSession(tenantId)
  if (!session) throw new Error('QuickBooks is not connected for this tenant.')

  // Look up the QBO ID mapped to this estimate
  const syncLog = await prisma.quickBooksSyncLog.findFirst({
    where: {
      integrationId: session.integrationId,
      entityId: estimateId,
      type: 'estimate',
      status: { in: ['success', 'conflict'] },
    },
    orderBy: { id: 'desc' },
    select: { qboId: true },
  })

  if (!syncLog?.qboId) {
    throw new Error('This estimate was not imported from QuickBooks, or no QBO mapping was found.')
  }

  const qboResponse = await quickBooksService.makeAPIRequest(
    session.accessToken,
    session.realmId,
    qboEstimateReadEndpoint(syncLog.qboId),
    'GET',
    undefined,
    {
      tenantId,
      entityType: 'estimate',
      entityId: syncLog.qboId,
      triggerSource: 'reimport_lines',
    }
  )

  const qboEstimate = qboResponse?.Estimate
  if (!qboEstimate?.Id) {
    throw new Error('QuickBooks estimate not found. It may have been deleted or made inactive.')
  }

  const { lineRows } = buildImportedEstimateLineRows(qboEstimate)

  await prisma.$transaction(async (tx) => {
    await tx.estimateLineItem.deleteMany({ where: { estimateId } })
    if (lineRows.length > 0) {
      await tx.estimateLineItem.createMany({
        data: lineRows.map((line: any) => ({
          estimateId,
          groupId: null,
          sourceItemId: null,
          sourceBundleId: null,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitCost: null,
          total: line.total,
          sortOrder: line.sortOrder,
          isVisibleToClient: true,
          showDescriptionToCustomer: true,
          showCostToCustomer: false,
          showPriceToCustomer: true,
          showTaxToCustomer: true,
          showNotesToCustomer: false,
          notes: line.notes,
          vendorId: null,
          taxable: line.taxable,
          taxRate: null,
          isSubtotal: line.isSubtotal === true,
        })),
      })
    }
  })

  const subtotalRows = lineRows.filter((l: any) => l.isSubtotal)
  const regularRows = lineRows.filter((l: any) => !l.isSubtotal)

  return {
    linesImported: lineRows.length,
    subtotalRowsAdded: subtotalRows.length,
    regularItemCount: regularRows.length,
  }
}

function extractSalesItemLines(qboLines: any): any[] {
  const lines = Array.isArray(qboLines) ? qboLines : []
  return lines.filter((l) => l && l.DetailType === 'SalesItemLineDetail')
}

/** Extract all customer-facing QBO lines (sales + subtotals) for ID matching on updates. */
function extractAllQboLines(qboLines: any): any[] {
  const lines = Array.isArray(qboLines) ? qboLines : []
  return lines.filter(
    (l) => l && (l.DetailType === 'SalesItemLineDetail' || l.DetailType === 'SubTotalLineDetail'),
  )
}

/** Build the QBO Line array from TrimPro line items. Subtotal rows become SubTotalLineDetail. */
function buildQboLines(lineItems: any[], serviceItemId: string): any[] {
  return lineItems.map((li: any) => {
    if (li.isSubtotal) {
      return {
        DetailType: 'SubTotalLineDetail',
        Amount: toNumber(li.total),
        SubTotalLineDetail: {},
      }
    }
    return {
      DetailType: 'SalesItemLineDetail',
      Description: li.notes || li.description,
      Amount: toNumber(li.quantity) * toNumber(li.unitPrice),
      SalesItemLineDetail: {
        ItemRef: { value: serviceItemId },
        Qty: toNumber(li.quantity),
        UnitPrice: toNumber(li.unitPrice),
      },
    }
  })
}

/** Build QBO Line array for updates, preserving existing QBO line IDs to prevent duplicates. */
function buildQboLinesWithIds(params: {
  localLineItems: any[]
  existingQboLines: any[]
  serviceItemId: string
}): any[] {
  const local = Array.isArray(params.localLineItems) ? params.localLineItems : []
  const existingSales = Array.isArray(params.existingQboLines)
    ? params.existingQboLines.filter((l) => l?.DetailType === 'SalesItemLineDetail')
    : []
  const existingSubtotals = Array.isArray(params.existingQboLines)
    ? params.existingQboLines.filter((l) => l?.DetailType === 'SubTotalLineDetail')
    : []

  let salesIdx = 0
  let subtotalIdx = 0

  return local.map((li: any) => {
    if (li.isSubtotal) {
      const existingLine = existingSubtotals[subtotalIdx++] || null
      const out: any = {
        DetailType: 'SubTotalLineDetail',
        Amount: toNumber(li.total),
        SubTotalLineDetail: {},
      }
      if (existingLine?.Id) out.Id = String(existingLine.Id)
      return out
    }
    const existingLine = existingSales[salesIdx++] || null
    const out: any = {
      DetailType: 'SalesItemLineDetail',
      Description: li?.notes || li?.description,
      Amount: toNumber(li?.quantity) * toNumber(li?.unitPrice),
      SalesItemLineDetail: {
        ItemRef: { value: params.serviceItemId },
        Qty: toNumber(li?.quantity),
        UnitPrice: toNumber(li?.unitPrice),
      },
    }
    if (existingLine?.Id) out.Id = String(existingLine.Id)
    return out
  })
}

/** @deprecated Use buildQboLinesWithIds instead. Kept for any external callers. */
function buildSalesItemLinesWithIds(params: {
  localLineItems: any[]
  existingQboSalesLines: any[]
  serviceItemId: string
}) {
  return buildQboLinesWithIds({
    localLineItems: params.localLineItems,
    existingQboLines: params.existingQboSalesLines,
    serviceItemId: params.serviceItemId,
  })
}

async function findCustomerByDisplayName(
  accessToken: string,
  realmId: string,
  displayName: string,
  context?: {
    tenantId?: string
    entityId?: string
    triggerSource?: string
  }
) {
  const cacheKey = makeLookupCacheKey(['customer', realmId, displayName])
  const cachedId = readCachedLookup(customerLookupCache, cacheKey)
  if (cachedId) return { Id: cachedId }

  const query = `select * from Customer where DisplayName='${esc(displayName)}' maxresults 1`
  const res = await quickBooksService.query(accessToken, realmId, query, {
    tenantId: context?.tenantId ?? null,
    entityType: 'client',
    entityId: context?.entityId ?? null,
    triggerSource: context?.triggerSource ?? 'client_lookup_by_name',
  })
  const customer = res?.QueryResponse?.Customer?.[0] || null
  if (customer?.Id) {
    writeCachedLookup(customerLookupCache, cacheKey, String(customer.Id), LOOKUP_CACHE_TTL_MS)
  }
  return customer
}

async function findVendorByDisplayName(
  accessToken: string,
  realmId: string,
  displayName: string
) {
  const cacheKey = makeLookupCacheKey(['vendor', realmId, displayName])
  const cachedId = readCachedLookup(vendorLookupCache, cacheKey)
  if (cachedId) return { Id: cachedId }

  const query = `select * from Vendor where DisplayName='${esc(displayName)}' maxresults 1`
  const res = await quickBooksService.query(accessToken, realmId, query)
  const vendor = res?.QueryResponse?.Vendor?.[0] || null
  if (vendor?.Id) {
    writeCachedLookup(vendorLookupCache, cacheKey, String(vendor.Id), LOOKUP_CACHE_TTL_MS)
  }
  return vendor
}

async function ensureIncomeAccount(
  accessToken: string,
  realmId: string,
  tenantId?: string,
  cached?: string | null
): Promise<string | null> {
  if (cached) return cached
  const res = await quickBooksService.query(
    accessToken,
    realmId,
    "select * from Account where AccountType='Income' maxresults 1"
  )
  const account = res?.QueryResponse?.Account?.[0]
  const accountId = account?.Id ? String(account.Id) : null
  if (tenantId && accountId) {
    try {
      await prisma.quickBooksIntegration.update({
        where: { tenantId },
        data: { incomeAccountId: accountId },
      })
    } catch {}
  }
  return accountId
}

async function ensureExpenseAccount(
  accessToken: string,
  realmId: string,
  tenantId: string,
  cached?: string | null
): Promise<string | null> {
  if (cached) return cached

  const cogs = await quickBooksService.query(
    accessToken,
    realmId,
    "select * from Account where AccountType='Cost of Goods Sold' maxresults 1"
  )
  const cogsAccount = cogs?.QueryResponse?.Account?.[0]
  const accountId = cogsAccount?.Id
    ? String(cogsAccount.Id)
    : await (async () => {
        const expense = await quickBooksService.query(
          accessToken,
          realmId,
          "select * from Account where AccountType='Expense' maxresults 1"
        )
        const expenseAccount = expense?.QueryResponse?.Account?.[0]
        return expenseAccount?.Id ? String(expenseAccount.Id) : null
      })()

  // Persist so future PO syncs don't need to query again.
  if (accountId) {
    try {
      await prisma.quickBooksIntegration.update({
        where: { tenantId },
        data: { cachedExpenseAccountId: accountId },
      })
    } catch {}
  }

  return accountId
}

async function ensureDefaultServiceItem(params: {
  accessToken: string
  realmId: string
  tenantId: string
  incomeAccountId: string | null
  /** Cached serviceItemId stored on the integration row — skip the QBO query if present. */
  serviceItemId?: string | null
}): Promise<string> {
  // Fast path: return the cached ID immediately (zero QBO calls).
  if (params.serviceItemId) return params.serviceItemId

  const found = await quickBooksService.query(
    params.accessToken,
    params.realmId,
    "select * from Item where Name='Trim Pro Service' maxresults 1"
  )
  const existing = found?.QueryResponse?.Item?.[0]
  let itemId = existing?.Id ? String(existing.Id) : null

  if (!itemId) {
    let incomeAccountId = params.incomeAccountId
    if (!incomeAccountId) {
      incomeAccountId = await ensureIncomeAccount(params.accessToken, params.realmId, params.tenantId)
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
    itemId = String(created?.Item?.Id || '')
  }

  if (!itemId) throw new Error('QuickBooks did not return service item id')

  // Persist so every future invoice/estimate sync is one QBO call lighter.
  try {
    await prisma.quickBooksIntegration.update({
      where: { tenantId: params.tenantId },
      data: { serviceItemId: itemId },
    })
  } catch {}

  return itemId
}

async function getCreditCardPaymentMethodId(params: {
  tenantId: string
  paymentId: string
  accessToken: string
  realmId: string
}): Promise<string | null> {
  const cacheKey = makeLookupCacheKey(['payment_method', params.tenantId, params.realmId, 'credit_card'])
  const cachedId = readCachedLookup(paymentMethodLookupCache, cacheKey)
  if (cachedId) return cachedId

  const pmQuery = encodeURIComponent("select * from PaymentMethod where Name = 'Credit Card'")
  const pmRes = await quickBooksService.makeAPIRequest(
    params.accessToken,
    params.realmId,
    `/query?query=${pmQuery}&minorversion=65`,
    'GET',
    undefined,
    {
      tenantId: params.tenantId,
      entityType: 'payment',
      entityId: params.paymentId,
      triggerSource: 'payment_method_lookup',
    }
  )
  const pmId = pmRes?.QueryResponse?.PaymentMethod?.[0]?.Id
  if (!pmId) return null

  const normalized = String(pmId)
  writeCachedLookup(paymentMethodLookupCache, cacheKey, normalized, PAYMENT_METHOD_CACHE_TTL_MS)
  return normalized
}

async function ensureClientCustomer(params: {
  tenantId: string
  clientId: string
  accessToken: string
  realmId: string
  integrationId: string
  createIfMissing?: boolean
  verifyMappedId?: boolean
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

  // If this is a sub-client, ensure the parent is synced to QBO first so we
  // can set ParentRef on the child customer.
  let parentQboId: string | null = null
  if (client.parentId) {
    parentQboId = await ensureClientCustomer({
      tenantId: params.tenantId,
      clientId: client.parentId,
      accessToken: params.accessToken,
      realmId: params.realmId,
      integrationId: params.integrationId,
      createIfMissing: true,
      verifyMappedId: true,
    })
    if (!parentQboId) {
      throw new Error(
        'Cannot sync sub-client to QuickBooks: parent client is not linked to a QuickBooks customer yet. Open the parent client, save or sync to QuickBooks, then retry.'
      )
    }
  }

  let mappedId = await getMappedQboId(params.integrationId, 'client', client.id)
  const createIfMissing = params.createIfMissing !== false
  const billing = client.addresses?.[0]
  const primaryEmail = getPrimaryEmail(client.email)
  const customerCtx = {
    tenantId: params.tenantId,
    entityType: 'client',
    entityId: client.id,
    triggerSource: client.parentId ? 'client_sync_subcustomer' : 'client_sync',
  }
  const basePayload = () =>
    ({
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
    }) as any
  const buildUpdatePayload = () => basePayload()
  const buildCreatePayload = () =>
    ({
      ...basePayload(),
      ...(parentQboId
        ? {
            ParentRef: { value: parentQboId },
            Job: true,
          }
        : {}),
    }) as any

  // Hash the fields that matter to QBO.  If the hash matches the last
  // successful sync we skip the GET + PUT entirely (saves 2 QBO calls per
  // invoice/estimate sync when the client hasn't changed).
  const dataHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      name: client.name,
      companyName: client.companyName,
      email: primaryEmail,
      phone: client.phone,
      billing: billing
        ? `${billing.street}|${billing.city}|${billing.state}|${billing.zipCode}`
        : null,
      parentQboId: parentQboId || null,
    }))
    .digest('hex')
    .slice(0, 16)

  try {
    if (mappedId) {
      // Check whether the last successful sync used the same data hash.
      const lastSync = await prisma.quickBooksSyncLog.findFirst({
        where: {
          integrationId: params.integrationId,
          type: 'client',
          entityId: client.id,
          status: 'success',
          qboId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { data: true, qboId: true },
      })
      const lastHash = (lastSync?.data as any)?.dataHash
      if (lastHash && lastHash === dataHash && lastSync?.qboId && !params.verifyMappedId) {
        // Nothing changed — skip the QBO update entirely.
        return String(lastSync.qboId)
      }

      const current = await quickBooksService.makeAPIRequest(
        params.accessToken,
        params.realmId,
        `/customer/${mappedId}`,
        'GET',
        undefined,
        customerCtx
      )
      if (lastHash && lastHash === dataHash && lastSync?.qboId) {
        return String(lastSync.qboId)
      }
      const syncToken = current?.Customer?.SyncToken || '0'
      const updated = await quickBooksService.updateCustomer(
        params.accessToken,
        params.realmId,
        mappedId,
        { ...buildUpdatePayload(), SyncToken: syncToken, sparse: true },
        customerCtx
      )
      const qboId = String(updated?.Customer?.Id || mappedId)
      await logSync({
        integrationId: params.integrationId,
        type: 'client',
        action: 'update',
        status: 'success',
        entityId: client.id,
        qboId,
        data: { dataHash },
      })
      return qboId
    }
  } catch (error: any) {
    if (mappedId && (isQboMissingOrDeletedEntityError(error) || isQboDeletedListReferenceError(error))) {
      invalidateCustomerLookupCache(params.realmId, [client.name, client.companyName])
      await logSync({
        integrationId: params.integrationId,
        type: 'client',
        action: 'recover_stale_mapping',
        status: 'conflict',
        entityId: client.id,
        qboId: mappedId,
        error: getErrorMessage(error),
      })
      mappedId = null
    } else {
      await logSync({
        integrationId: params.integrationId,
        type: 'client',
        action: 'update',
        status: 'error',
        entityId: client.id,
        qboId: mappedId,
        error: error?.message || 'QuickBooks customer update failed',
      })
      throw error
    }
  }

  // Try to link clients by DisplayName before creating, to avoid duplicates.
  // For sub-clients we restrict to Job=true matches to avoid false positives.
  const linkCandidates = Array.from(
    new Set([client.name, client.companyName].map((v) => String(v || '').trim()).filter(Boolean))
  )
  for (const candidate of linkCandidates) {
    const existing = await findCustomerByDisplayName(params.accessToken, params.realmId, candidate, {
      tenantId: params.tenantId,
      entityId: client.id,
      triggerSource: 'client_link_by_name',
    })
    // For sub-clients only accept a Job match to avoid hijacking unrelated top-level customers
    if (existing?.Id && (!client.parentId || existing.Job)) {
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

  /**
   * Helper: if create fails with "duplicate name" (code=6240), fall back to a name lookup
   * and link the pre-existing QBO customer rather than failing.
   */
  async function createOrRelink(payload: any): Promise<string> {
    try {
      const res = await quickBooksService.createCustomer(params.accessToken, params.realmId, payload, customerCtx)
      const id = String(res?.Customer?.Id || '')
      if (!id) throw new Error('QuickBooks did not return customer id after create')
      return id
    } catch (createErr: any) {
      if (isQboDuplicateNameError(createErr)) {
        // Customer already exists in QBO — find it by name and link
        for (const candidate of linkCandidates) {
          const found = await findCustomerByDisplayName(params.accessToken, params.realmId, candidate, {
            tenantId: params.tenantId,
            entityId: client.id,
            triggerSource: 'client_relink_after_duplicate',
          })
          if (found?.Id && (!client.parentId || found.Job)) {
            const qboId = String(found.Id)
            await logSync({
              integrationId: params.integrationId,
              type: 'client',
              action: 'link',
              status: 'success',
              entityId: client.id,
              qboId,
              data: { matchedDisplayName: candidate, reason: 'relink_after_6240' },
            })
            return qboId
          }
        }
      }
      throw createErr
    }
  }

  let qboId: string
  if (!parentQboId) {
    qboId = await createOrRelink(buildCreatePayload())
  } else {
    try {
      qboId = await createOrRelink(buildCreatePayload())
    } catch {
      try {
        const jobStyle: any = {
          DisplayName: client.name,
          ParentRef: { value: parentQboId },
          Job: true,
        }
        if (primaryEmail) jobStyle.PrimaryEmailAddr = { Address: primaryEmail }
        if (client.phone) jobStyle.PrimaryPhone = { FreeFormNumber: client.phone }
        qboId = await createOrRelink(jobStyle)
      } catch {
        const isSubOnly: any = {
          DisplayName: client.name,
          ParentRef: { value: parentQboId },
          Job: true,
        }
        if (primaryEmail) isSubOnly.PrimaryEmailAddr = { Address: primaryEmail }
        if (client.phone) isSubOnly.PrimaryPhone = { FreeFormNumber: client.phone }
        qboId = await createOrRelink(isSubOnly)
      }
    }
  }
  if (!qboId) throw new Error('QuickBooks did not return customer id')
  await logSync({
    integrationId: params.integrationId,
    type: 'client',
    action: 'create',
    status: 'success',
    entityId: client.id,
    qboId,
    data: { dataHash },
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

  let qboId: string
  try {
    const created = await quickBooksService.createCustomer(params.accessToken, params.realmId, {
      DisplayName: params.displayName,
      ParentRef: { value: params.parentCustomerQboId },
      Job: true,
    })
    qboId = String(created?.Customer?.Id || '')
  } catch (createErr: any) {
    if (isQboDuplicateNameError(createErr)) {
      // Already exists — re-query without Job filter as a fallback
      const retry = await quickBooksService.query(params.accessToken, params.realmId,
        `select * from Customer where DisplayName='${esc(params.displayName)}' maxresults 1`)
      const retryCustomer = retry?.QueryResponse?.Customer?.[0]
      if (retryCustomer?.Id) {
        qboId = String(retryCustomer.Id)
      } else {
        throw createErr
      }
    } else {
      throw createErr
    }
  }
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
  if (!session) {
    await logQboSessionUnavailable(tenantId, 'client', clientId)
    throw new Error(QBO_SESSION_UNAVAILABLE_MSG)
  }
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
    throw error
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
  if (!session) {
    await logQboSessionUnavailable(tenantId, 'estimate', estimateId)
    return
  }
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

    // Try to resolve the QBO customer id without triggering a full push.
    // ensureClientCustomer(false) skips creation but still updates the customer in QBO if its
    // data hash changed, so already-mapped clients stay current.
    // Only call syncClientToQuickBooks (which also rethrows) when the client has never been mapped.
    let customerQboId = await ensureClientCustomer({
      tenantId,
      clientId: estimate.clientId,
      accessToken: session.accessToken,
      realmId: session.realmId,
      integrationId: session.integrationId,
      createIfMissing: false,
    })
    if (!customerQboId) {
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
    if (!customerQboId) {
      throw new Error(
        'QuickBooks estimate sync skipped: this client is not linked to a QuickBooks customer. Check QuickBooks connection and sync/import the client, then retry.'
      )
    }

    const existingQboId = await getMappedQboId(session.integrationId, 'estimate', estimate.id)

    const serviceItemId = await ensureDefaultServiceItem({
      accessToken: session.accessToken,
      realmId: session.realmId,
      tenantId: session.tenantId,
      incomeAccountId: session.incomeAccountId,
      serviceItemId: session.serviceItemId,
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
      Line: buildQboLines(lineItems, serviceItemId),
    }

    if (existingQboId) {
      const fetched = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        qboEstimateReadEndpoint(String(existingQboId)),
        'GET',
        undefined,
        {
          tenantId,
          entityType: 'estimate',
          entityId: estimate.id,
          triggerSource: 'estimate_sync',
        }
      )
      const qboEstimate = fetched?.Estimate
      const syncToken = qboEstimate?.SyncToken
      if (!syncToken) throw new Error('QuickBooks estimate SyncToken missing (cannot update)')

      const existingQboLines = extractAllQboLines(qboEstimate?.Line)
      const updatePayload: any = {
        ...payload,
        Id: existingQboId,
        SyncToken: String(syncToken),
        // Full update so line additions/removals (including subtotals) reflect in QBO.
        Line: buildQboLinesWithIds({
          localLineItems: lineItems,
          existingQboLines,
          serviceItemId,
        }),
      }

      const updated = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        '/estimate?operation=update',
        'POST',
        updatePayload,
        {
          tenantId,
          entityType: 'estimate',
          entityId: estimate.id,
          triggerSource: 'estimate_sync',
        }
      )
      const qboId = String(updated?.Estimate?.Id || existingQboId)
      await logSync({
        integrationId: session.integrationId,
        type: 'estimate',
        action: 'update',
        status: 'success',
        entityId: estimate.id,
        qboId,
      })
      return
    }

    const created = await quickBooksService.makeAPIRequest(
      session.accessToken,
      session.realmId,
      '/estimate',
      'POST',
      payload,
      {
        tenantId,
        entityType: 'estimate',
        entityId: estimate.id,
        triggerSource: 'estimate_sync',
      }
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
  if (!session) {
    await logQboSessionUnavailable(tenantId, 'invoice', invoiceId)
    return
  }
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

    let customerQboId = await ensureClientCustomer({
      tenantId,
      clientId: invoice.clientId,
      accessToken: session.accessToken,
      realmId: session.realmId,
      integrationId: session.integrationId,
      createIfMissing: false,
    })
    if (!customerQboId) {
      await syncClientToQuickBooks(tenantId, invoice.clientId)
      customerQboId = await ensureClientCustomer({
        tenantId,
        clientId: invoice.clientId,
        accessToken: session.accessToken,
        realmId: session.realmId,
        integrationId: session.integrationId,
        createIfMissing: false,
      })
    }
    if (!customerQboId) {
      throw new Error(
        'QuickBooks invoice sync skipped: this client is not linked to a QuickBooks customer. Check QuickBooks connection and sync/import the client, then retry.'
      )
    }

    const serviceItemId = await ensureDefaultServiceItem({
      accessToken: session.accessToken,
      realmId: session.realmId,
      tenantId: session.tenantId,
      incomeAccountId: session.incomeAccountId,
      serviceItemId: session.serviceItemId,
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

    // Link to Estimate when present so QBO treats this like a conversion.
    if (invoice.estimateId) {
      let estimateQboId = await getMappedQboId(session.integrationId, 'estimate', invoice.estimateId)
      if (!estimateQboId) {
        await syncEstimateToQuickBooks(tenantId, invoice.estimateId)
        estimateQboId = await getMappedQboId(session.integrationId, 'estimate', invoice.estimateId)
      }
      if (estimateQboId) payload.LinkedTxn = [{ TxnId: estimateQboId, TxnType: 'Estimate' }]
    }

    if (invoice.qboSyncId) {
      const fetched = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        `/invoice/${invoice.qboSyncId}`,
        'GET',
        undefined,
        {
          tenantId,
          entityType: 'invoice',
          entityId: invoice.id,
          triggerSource: 'invoice_sync',
        }
      )
      const qboInvoice = fetched?.Invoice
      const syncToken = qboInvoice?.SyncToken
      if (!syncToken) throw new Error('QuickBooks invoice SyncToken missing (cannot update)')

      const existingSalesLines = extractSalesItemLines(qboInvoice?.Line)
      const updatePayload: any = {
        ...payload,
        Id: invoice.qboSyncId,
        SyncToken: String(syncToken),
        Line: buildSalesItemLinesWithIds({
          localLineItems: lineItems,
          existingQboSalesLines: existingSalesLines,
          serviceItemId,
        }),
      }

      const updated = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        '/invoice?operation=update',
        'POST',
        updatePayload,
        {
          tenantId,
          entityType: 'invoice',
          entityId: invoice.id,
          triggerSource: 'invoice_sync',
        }
      )
      const qboId = String(updated?.Invoice?.Id || invoice.qboSyncId)
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          qboSyncAt: new Date(),
        },
      })
      await logSync({
        integrationId: session.integrationId,
        type: 'invoice',
        action: 'update',
        status: 'success',
        entityId: invoice.id,
        qboId,
      })
      return
    }

    const created = await quickBooksService.createInvoice(
      session.accessToken,
      session.realmId,
      payload,
      {
        tenantId,
        entityType: 'invoice',
        entityId: invoice.id,
        triggerSource: 'invoice_sync',
      }
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

    // IMPORTANT: To ensure QBO applies the payment to the *existing* invoice (and shows PARTIALLY PAID
    // when balance remains), we must use the same CustomerRef as the invoice in QBO. Otherwise QBO
    // may reject or mis-apply the payment.
    const qboInvoiceRes = await quickBooksService.makeAPIRequest(
      session.accessToken,
      session.realmId,
      `/invoice/${invoiceQboId}`,
      'GET',
      undefined,
      {
        tenantId,
        entityType: 'payment',
        entityId: payment.id,
        triggerSource: 'payment_sync',
      }
    )
    const customerQboId =
      String(qboInvoiceRes?.Invoice?.CustomerRef?.value || '') ||
      (await ensureClientCustomer({
        tenantId,
        clientId: payment.invoice.clientId,
        accessToken: session.accessToken,
        realmId: session.realmId,
        integrationId: session.integrationId,
        // Do not create a customer as a side-effect of payment sync.
        createIfMissing: false,
      }))
    if (!customerQboId) throw new Error('Unable to resolve customer in QuickBooks for payment')

    const amount = toNumber(payment.amount)
    const invoiceNumber = payment.invoice.invoiceNumber || payment.invoice.id
    const paymentNote = payment.reference || payment.notes || `Payment for Invoice ${invoiceNumber}`

    // Determine if this is a card payment and get the transaction ID for "Conf ID"
    const isCardPayment =
      (payment as any).method === 'CARD' ||
      (payment as any).provider === 'sola' ||
      !!(payment as any).solaTransactionId
    const transactionId =
      (payment as any).providerPaymentId ||
      (payment as any).solaTransactionId ||
      payment.reference ||
      ''

    // For card payments, look up the QBO Credit Card payment method
    let paymentMethodRef: { value: string } | undefined
    if (isCardPayment) {
      try {
        const pmId = await getCreditCardPaymentMethodId({
          tenantId,
          paymentId,
          accessToken: session.accessToken,
          realmId: session.realmId,
        })
        if (pmId) {
          paymentMethodRef = { value: String(pmId) }
        }
      } catch {
        // Non-fatal: proceed without PaymentMethodRef
      }
    }

    const payload: Record<string, unknown> = {
      CustomerRef: { value: customerQboId },
      TotalAmt: amount,
      TxnDate: qboDate(payment.processedAt || payment.createdAt),
      PrivateNote: paymentNote,
      // RefNumber maps to "Conf ID" in QuickBooks for card transaction reference
      ...(isCardPayment && transactionId ? { RefNumber: transactionId } : {}),
      ...(paymentMethodRef ? { PaymentMethodRef: paymentMethodRef } : {}),
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
      payload,
      {
        tenantId,
        entityType: 'payment',
        entityId: payment.id,
        triggerSource: 'payment_sync',
      }
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

    const vendorCtx = { tenantId, entityType: 'vendor', entityId: vendor.id, triggerSource: 'vendor_sync' }
    if (mappedId) {
      const current = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        `/vendor/${mappedId}`,
        'GET',
        undefined,
        vendorCtx
      )
      const syncToken = current?.Vendor?.SyncToken || '0'
      const updated = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        '/vendor?operation=update',
        'POST',
        { ...payload, Id: mappedId, SyncToken: syncToken, sparse: true },
        vendorCtx
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
      payload,
      vendorCtx
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

    const expenseAccountId = await ensureExpenseAccount(
      session.accessToken,
      session.realmId,
      session.tenantId,
      session.cachedExpenseAccountId,
    )
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

    const poCtx = { tenantId, entityType: 'purchase_order', entityId: po.id, triggerSource: 'po_sync' }
    const mappedPoQboId = await getMappedQboId(session.integrationId, 'purchase_order', po.id)
    if (mappedPoQboId) {
      const current = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        `/purchaseorder/${mappedPoQboId}`,
        'GET',
        undefined,
        poCtx
      )
      const syncToken = current?.PurchaseOrder?.SyncToken || '0'
      const updated = await quickBooksService.makeAPIRequest(
        session.accessToken,
        session.realmId,
        '/purchaseorder?operation=update',
        'POST',
        { ...payload, Id: mappedPoQboId, SyncToken: syncToken },
        poCtx
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
      payload,
      poCtx
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
  let skippedExistingClients = 0
  let importedOpenInvoices = 0
  let skippedOpenInvoices = 0
  let reassignedInvoices = 0
  /** QuickBooks invoices with Balance > 0 seen while open-invoice import ran */
  let qboOpenInvoicesScanned = 0
  /** Those invoices already had a TrimPro row (matched by qboSyncId) */
  let openInvoicesAlreadyInTrimPro = 0
  let importedPayments = 0
  let skippedPayments = 0
  let importedItems = 0
  const errors: string[] = []

  // Import customers
  // Keep a local in-memory mapping so subcustomers can be linked even if the parent is on a later page.
  const qboCustomerIdToLocalClientId = new Map<string, string>()
  const pendingParentLinks: Array<{ childLocalId: string; parentQboId: string }> = []

  // Load QBO→TrimPro client mappings from the sync log. Prefer sub-client over parent when both
  // exist for the same QBO customer ID. Rebuilt again after the live QBO customer import loop so
  // `getReusableMappedClientId` cannot leave the map pointing at a merged parent instead of the
  // dedicated sub-client row.
  const refreshQboCustomerIdMapFromSyncLog = async () => {
    qboCustomerIdToLocalClientId.clear()
    const existingClientMaps = await prisma.quickBooksSyncLog.findMany({
      where: {
        integrationId: session.integrationId,
        type: 'client',
        status: 'success',
        qboId: { not: null },
        entityId: { not: null },
      },
      select: { qboId: true, entityId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    const mappedClientIds = Array.from(
      new Set(existingClientMaps.map((r) => (r.entityId ? String(r.entityId) : null)).filter(Boolean) as string[]),
    )
    const existingClients = mappedClientIds.length
      ? await prisma.client.findMany({
          where: { tenantId, id: { in: mappedClientIds } },
          select: { id: true, parentId: true },
        })
      : []
    const existingClientIdSet = new Set(existingClients.map((c) => c.id))
    const parentIdByClientId = new Map(existingClients.map((c) => [c.id, c.parentId]))

    const rowsByQboId = new Map<string, Array<{ entityId: string; createdAt: Date }>>()
    for (const row of existingClientMaps) {
      if (!row.qboId || !row.entityId) continue
      const localId = String(row.entityId)
      if (!existingClientIdSet.has(localId)) continue
      const qboIdKey = String(row.qboId)
      const list = rowsByQboId.get(qboIdKey) || []
      list.push({ entityId: localId, createdAt: row.createdAt })
      rowsByQboId.set(qboIdKey, list)
    }

    for (const [qboIdKey, rows] of rowsByQboId.entries()) {
      const subRows = rows.filter((r) => parentIdByClientId.get(r.entityId))
      const chosen = subRows.length > 0 ? subRows[0] : rows[0]
      qboCustomerIdToLocalClientId.set(qboIdKey, chosen.entityId)
    }
  }

  await refreshQboCustomerIdMapFromSyncLog()

  /** Resolve QBO Customer Id → TrimPro client id (prefer sub-client when sync log has conflicts). */
  const resolveQboCustomerToLocalClientId = async (qboCustomerId: string): Promise<string | null> => {
    const key = String(qboCustomerId || '').trim()
    if (!key) return null
    const cached = qboCustomerIdToLocalClientId.get(key)
    if (cached) return cached

    const rows = await prisma.quickBooksSyncLog.findMany({
      where: {
        integrationId: session.integrationId,
        type: 'client',
        status: 'success',
        qboId: key,
        entityId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true },
    })
    const orderedIds: string[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      const id = String(row.entityId)
      if (seen.has(id)) continue
      seen.add(id)
      orderedIds.push(id)
    }
    if (!orderedIds.length) return null
    const clients = await prisma.client.findMany({
      where: { tenantId, id: { in: orderedIds } },
      select: { id: true, parentId: true },
    })
    const pmap = new Map(clients.map((c) => [c.id, c.parentId]))
    for (const id of orderedIds) {
      if (pmap.get(id)) {
        qboCustomerIdToLocalClientId.set(key, id)
        return id
      }
    }
    const rootId = orderedIds[0]
    qboCustomerIdToLocalClientId.set(key, rootId)
    return rootId
  }

  const getReusableMappedClientId = async (qboId: string): Promise<string | null> => {
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
    if (!existingMap?.entityId) return null

    const localId = String(existingMap.entityId)
    const stillExists = await prisma.client.findFirst({
      where: { id: localId, tenantId },
      select: { id: true },
    })
    if (!stillExists) return null

    // Historical bad imports sometimes mapped multiple QB customer IDs into one
    // TrimPro client. Keep only the earliest QB mapping for that local client.
    const firstMappingForLocal = await prisma.quickBooksSyncLog.findFirst({
      where: {
        integrationId: session.integrationId,
        type: 'client',
        status: 'success',
        entityId: localId,
        qboId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      select: { qboId: true },
    })

    return firstMappingForLocal?.qboId === qboId ? localId : null
  }

  for (let start = 1; start <= 50000; start += 1000) {
    // Include both active AND inactive customers so nothing is hidden from the import.
    const query = `select * from Customer WHERE Active IN (true, false) startposition ${start} maxresults 1000`
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

      const reusableMappedClientId = await getReusableMappedClientId(normalizedParent)
      if (reusableMappedClientId) {
        qboCustomerIdToLocalClientId.set(normalizedParent, reusableMappedClientId)
        return reusableMappedClientId
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
      const parentActive = typeof parent.Active === 'boolean' ? parent.Active : true

      // Always create a new client — no name/email dedup to avoid false merges.
      const created = await prisma.client.create({
        data: {
          tenantId,
          name: String(parentName),
          companyName: parentCompanyName ? String(parentCompanyName) : null,
          email: parentEmail ? String(parentEmail) : null,
          phone: parentPhone ? String(parentPhone) : null,
          notes: parentActive
            ? 'Imported from QuickBooks (parent auto-import during subclient import)'
            : 'Imported from QuickBooks (parent auto-import, inactive in QuickBooks)',
          isActive: true,
        },
      })

      await logSync({
        integrationId: session.integrationId,
        type: 'client',
        action: 'import',
        status: 'success',
        entityId: created.id,
        qboId: String(parent.Id),
        data: { parentQboId: null, qboJob: Boolean(parent?.Job) },
      })

      importedClients += 1
      qboCustomerIdToLocalClientId.set(String(parent.Id), created.id)
      return created.id
    }

    const importOneCustomer = async (c: any) => {
      try {
        const qboId = String(c.Id || '')
        if (!qboId) return

        const reusableMappedClientId = await getReusableMappedClientId(qboId)
        if (reusableMappedClientId) {
          qboCustomerIdToLocalClientId.set(qboId, reusableMappedClientId)
          skippedExistingClients += 1
          return
        }

        const parentQboId = c?.ParentRef?.value ? String(c.ParentRef.value) : null
        const parentLocalId = parentQboId
          ? await resolveOrImportParentClientId(parentQboId, qboId)
          : null

        const name = c.DisplayName || c.CompanyName || 'QuickBooks Client'
        const email = c.PrimaryEmailAddr?.Address || null
        const phone = c.PrimaryPhone?.FreeFormNumber || null
        const companyName = c.CompanyName || null
        const isActive = typeof c.Active === 'boolean' ? c.Active : true

        // Always create a new TrimPro client for each unique QB customer ID.
        // We do NOT try to match by name or email — that caused false merges where
        // multiple distinct QB customers collapsed into one TrimPro record.
        // Idempotency is handled above via the QB ID sync log check, so re-running
        // the import multiple times will not create duplicate TrimPro clients.
        const client = await prisma.client.create({
          data: {
            tenantId,
            parentId: parentLocalId,
            name: String(name),
            companyName: companyName ? String(companyName) : null,
            email: email ? String(email) : null,
            phone: phone ? String(phone) : null,
            notes: isActive
              ? 'Imported from QuickBooks'
              : 'Imported from QuickBooks (inactive)',
            isActive: true,
          },
        })

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
        importedClients += 1
        if (parentLocalId) importedSubClients += 1

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

  await refreshQboCustomerIdMapFromSyncLog()

  // Import Items (products/services) when requested.
  for (let start = 1; includeItems && start <= 50000; start += 1000) {
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

        qboOpenInvoicesScanned += 1

        const customerQboId = inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : ''
        const resolvedClientId = customerQboId ? await resolveQboCustomerToLocalClientId(customerQboId) : null

        const exists = await prisma.invoice.findFirst({
          where: { tenantId, qboSyncId: qboInvoiceId },
          select: { id: true, clientId: true },
        })
        if (exists) {
          openInvoicesAlreadyInTrimPro += 1
          // Invoice already imported — check if it was assigned to the wrong client.
          // This happens when an old name-merge import put the invoice on a parent client
          // but the correct mapping (newest) is a dedicated sub-client.
          if (resolvedClientId && exists.clientId !== resolvedClientId) {
            try {
              await prisma.invoice.update({
                where: { id: exists.id },
                data: { clientId: resolvedClientId },
              })
              reassignedInvoices++
            } catch {
              // best-effort
            }
          }
          continue
        }
        const clientId = resolvedClientId

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
            notes: (l as any).notes || null,
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
    skippedExistingClients,
    importedItems,
    importedOpenInvoices,
    skippedOpenInvoices,
    reassignedInvoices,
    qboOpenInvoicesScanned,
    openInvoicesAlreadyInTrimPro,
    importedPayments,
    skippedPayments,
    errors: errors.slice(0, 20),
  }
}

