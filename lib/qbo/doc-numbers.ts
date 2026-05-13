import { prisma } from '@/lib/prisma'
import { getQboSessionForTenant } from '@/lib/qbo/session'
import { quickBooksService } from '@/lib/services/quickbooks'

function esc(value: string): string {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function normalizeEstimateNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return `EST-${raw.padStart(6, '0')}`
  const match = raw.match(/^EST-(\d+)$/i)
  if (match) return `EST-${match[1].padStart(6, '0')}`
  return raw
}

export function normalizeInvoiceNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return `INV-${raw.padStart(6, '0')}`
  const match = raw.match(/^INV-(\d+)$/i)
  if (match) return `INV-${match[1].padStart(6, '0')}`
  return raw
}

async function qboDocNumberExists(
  tenantId: string,
  entityType: 'Estimate' | 'Invoice',
  docNumber: string
): Promise<boolean> {
  const session = await getQboSessionForTenant(tenantId)
  if (!session) return false

  const result = await quickBooksService.query(
    session.accessToken,
    session.realmId,
    `select Id, DocNumber from ${entityType} where DocNumber = '${esc(docNumber)}' maxresults 1`,
    {
      tenantId,
      entityType: entityType.toLowerCase(),
      triggerSource: `${entityType.toLowerCase()}_number_allocation`,
    }
  )
  const matches = result?.QueryResponse?.[entityType] || []
  return Array.isArray(matches) && matches.length > 0
}

async function qboEstimateDocNumberExists(tenantId: string, estimateNumber: string): Promise<boolean> {
  return qboDocNumberExists(tenantId, 'Estimate', estimateNumber)
}

async function qboInvoiceDocNumberExists(tenantId: string, invoiceNumber: string): Promise<boolean> {
  return qboDocNumberExists(tenantId, 'Invoice', invoiceNumber)
}

export async function assertEstimateNumberAvailableInQuickBooks(
  tenantId: string,
  estimateNumber: string
) {
  if (await qboEstimateDocNumberExists(tenantId, estimateNumber)) {
    throw new Error(`Estimate number ${estimateNumber} already exists in QuickBooks. Use a different number.`)
  }
}

export async function assertInvoiceNumberAvailableInQuickBooks(
  tenantId: string,
  invoiceNumber: string
) {
  if (await qboInvoiceDocNumberExists(tenantId, invoiceNumber)) {
    throw new Error(`Invoice number ${invoiceNumber} already exists in QuickBooks. Use a different number.`)
  }
}

export async function allocateNextEstimateNumber(params: {
  tenantId: string
  db?: any
  maxAttempts?: number
}) {
  const db = params.db || prisma
  const maxAttempts = params.maxAttempts ?? 300
  const latestEstimate = await db.estimate.findFirst({
    where: { estimateNumber: { startsWith: 'EST-' } },
    orderBy: { estimateNumber: 'desc' },
    select: { estimateNumber: true },
  })
  const latestNumMatch = latestEstimate?.estimateNumber?.match(/^EST-(\d+)/)
  const latestNum = latestNumMatch ? parseInt(latestNumMatch[1], 10) : 0
  const baseNum = Number.isFinite(latestNum) ? latestNum : 0

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = `EST-${String(baseNum + attempt).padStart(6, '0')}`
    const localCollision = await db.estimate.findFirst({
      where: { estimateNumber: candidate },
      select: { id: true },
    })
    if (localCollision) continue
    if (await qboEstimateDocNumberExists(params.tenantId, candidate)) continue
    return candidate
  }

  throw new Error('Unable to allocate an unused estimate number in TrimPro and QuickBooks.')
}

export async function allocateNextInvoiceNumber(params: {
  tenantId: string
  db?: any
  maxAttempts?: number
}) {
  const db = params.db || prisma
  const maxAttempts = params.maxAttempts ?? 300
  const latestInvoice = await db.invoice.findFirst({
    where: { invoiceNumber: { startsWith: 'INV-' } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  })
  const latestNumMatch = latestInvoice?.invoiceNumber?.match(/^INV-(\d+)/)
  const latestNum = latestNumMatch ? parseInt(latestNumMatch[1], 10) : 0
  const baseNum = Number.isFinite(latestNum) ? latestNum : 0

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = `INV-${String(baseNum + attempt).padStart(6, '0')}`
    const localCollision = await db.invoice.findFirst({
      where: { invoiceNumber: candidate },
      select: { id: true },
    })
    if (localCollision) continue
    if (await qboInvoiceDocNumberExists(params.tenantId, candidate)) continue
    return candidate
  }

  throw new Error('Unable to allocate an unused invoice number in TrimPro and QuickBooks.')
}

