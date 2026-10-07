import { prisma } from '@/lib/prisma'

/**
 * Unified, readable per-entity history. Merges the human-readable Activity feed
 * (linked by FK) with the AuditLog (entityType + entityId) for a single record
 * into one time-sorted timeline. Read-only — it never writes to the record.
 */

export interface HistoryItem {
  id: string
  source: 'activity' | 'audit'
  timestamp: string
  actor: string
  action: string | null
  text: string
  changedFields?: string[]
}

interface EntityMapEntry {
  activityField?:
    | 'invoiceId' | 'estimateId' | 'jobId' | 'clientId' | 'purchaseOrderId'
    | 'creditMemoId' | 'paymentId' | 'taskId' | 'issueId' | 'leadId' | 'contactId'
  auditTypes?: string[]
  /** Permission required to read this entity's history. */
  permission?: string
}

// Normalized entity key -> where to read history from.
const ENTITY_MAP: Record<string, EntityMapEntry> = {
  invoice: { activityField: 'invoiceId', auditTypes: ['Invoice'], permission: 'invoices.view' },
  estimate: { activityField: 'estimateId', auditTypes: ['Estimate'], permission: 'estimates.view' },
  job: { activityField: 'jobId', auditTypes: ['Job', 'JobAssignment'], permission: 'jobs.view' },
  client: { activityField: 'clientId', auditTypes: ['Client'], permission: 'clients.view' },
  vendor: { auditTypes: ['Vendor'], permission: 'purchase_orders.view' },
  purchaseorder: { activityField: 'purchaseOrderId', auditTypes: ['PurchaseOrder'], permission: 'purchase_orders.view' },
  creditmemo: { activityField: 'creditMemoId', auditTypes: ['CreditMemo'], permission: 'invoices.view' },
  payment: { activityField: 'paymentId', auditTypes: ['Payment'], permission: 'payments.view' },
  task: { activityField: 'taskId', auditTypes: ['Task'], permission: 'tasks.view' },
  issue: { activityField: 'issueId', auditTypes: ['Issue'], permission: 'issues.view' },
  lead: { activityField: 'leadId', auditTypes: [], permission: 'leads.view' },
  attachment: { auditTypes: ['Attachment', 'RequestAttachment', 'File'] },
  file: { auditTypes: ['Attachment', 'RequestAttachment', 'File'] },
}

export function normalizeEntityKey(entityType: string): string {
  return String(entityType || '').toLowerCase().replace(/[^a-z]/g, '')
}

export function historyPermissionFor(entityType: string): string | undefined {
  return ENTITY_MAP[normalizeEntityKey(entityType)]?.permission
}

function actorName(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | null): string {
  if (!user) return 'System'
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim()
  return name || user.email || 'System'
}

const FRIENDLY: Record<string, string> = {
  Invoice: 'invoice', Estimate: 'estimate', Job: 'job', Client: 'client', Vendor: 'vendor',
  PurchaseOrder: 'purchase order', CreditMemo: 'credit memo', Payment: 'payment', Task: 'task',
  Issue: 'issue', JobAssignment: 'job assignment', Attachment: 'file', RequestAttachment: 'file', File: 'file',
}

const VERB: Record<string, string> = {
  CREATE: 'Created', UPDATE: 'Updated', DELETE: 'Deleted', REFUND: 'Refunded',
  VIEW: 'Viewed', DOWNLOAD: 'Downloaded', SEND: 'Sent',
  LOGIN: 'Signed in', LOGOUT: 'Signed out', PASSWORD_RESET: 'Reset password',
  PERMISSION_CHANGE: 'Changed permissions',
}

// Friendlier, plain-English labels for raw field keys.
const FIELD_LABELS: Record<string, string> = {
  estimateNumber: 'number', invoiceNumber: 'number', poNumber: 'number', creditMemoNumber: 'number',
  clientId: 'customer', vendorId: 'vendor', assigneeId: 'assignee', assignee: 'assignee',
  dueDate: 'due date', validUntil: 'valid-until date', creditMemoDate: 'date', processedAt: 'date',
  unitPrice: 'unit price', taxRate: 'tax', hourlyRateCents: 'hourly rate', chargeByHour: 'billing type',
  isNotesVisibleToClient: 'notes visibility', paymentTerms: 'payment terms',
}

function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]
  // camelCase / PascalCase -> spaced lower case
  return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim().toLowerCase()
}

/** Pull a readable list of changed fields + any line-item summary from the (inconsistent) changes JSON. */
function changedInfoOf(changes: any): { fields: string[]; lineSummary: string | null } {
  if (!changes || typeof changes !== 'object') return { fields: [], lineSummary: null }
  const lineSummary =
    changes.lineItems && typeof changes.lineItems === 'object' && typeof changes.lineItems.summary === 'string'
      ? changes.lineItems.summary
      : null
  const after = changes.after && typeof changes.after === 'object' ? changes.after : null
  const before = changes.before && typeof changes.before === 'object' ? changes.before : null
  const NOISE = new Set(['id', 'updatedAt', 'createdAt', 'before', 'after', 'tenantId', 'lineItems'])
  let keys: string[]
  if (after) {
    const afterKeys = Object.keys(after).filter((k) => !NOISE.has(k))
    keys = before
      ? afterKeys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      : afterKeys
  } else {
    keys = Object.keys(changes).filter((k) => !NOISE.has(k))
  }
  const labels = Array.from(new Set(keys.map(fieldLabel))).slice(0, 12)
  return { fields: labels, lineSummary }
}

function auditText(action: string, entityType: string, info: { fields: string[]; lineSummary: string | null }): string {
  const verb = VERB[action] || action
  const noun = FRIENDLY[entityType] || entityType.replace(/([A-Z])/g, ' $1').trim().toLowerCase()
  if (action === 'UPDATE') {
    const bits: string[] = []
    if (info.fields.length) bits.push(info.fields.slice(0, 6).join(', ') + (info.fields.length > 6 ? '…' : ''))
    if (info.lineSummary) bits.push(`line items: ${info.lineSummary}`)
    if (bits.length) return `${verb} ${noun} — changed ${bits.join('; ')}`
  }
  return `${verb} ${noun}`
}

export async function getEntityHistory(params: {
  tenantId: string
  entityType: string
  entityId: string
  limit?: number
}): Promise<HistoryItem[]> {
  const { tenantId, entityId } = params
  const limit = params.limit ?? 100
  const map = ENTITY_MAP[normalizeEntityKey(params.entityType)]
  if (!map || !entityId) return []

  const userSelect = { select: { firstName: true, lastName: true, email: true } } as const

  const [activities, audits] = await Promise.all([
    map.activityField
      ? prisma.activity.findMany({
          where: { tenantId, [map.activityField]: entityId } as any,
          include: { user: userSelect },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
      : Promise.resolve([] as any[]),
    map.auditTypes && map.auditTypes.length
      ? prisma.auditLog.findMany({
          where: { tenantId, entityType: { in: map.auditTypes }, entityId },
          include: { user: userSelect },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
      : Promise.resolve([] as any[]),
  ])

  const items: HistoryItem[] = []
  for (const a of activities as any[]) {
    items.push({
      id: `act_${a.id}`,
      source: 'activity',
      timestamp: a.createdAt.toISOString(),
      actor: actorName(a.user),
      action: null,
      text: a.description,
    })
  }
  for (const l of audits as any[]) {
    const info = changedInfoOf(l.changes)
    items.push({
      id: `aud_${l.id}`,
      source: 'audit',
      timestamp: l.createdAt.toISOString(),
      actor: actorName(l.user),
      action: l.action,
      text: auditText(l.action, l.entityType, info),
      changedFields: info.fields.length ? info.fields : undefined,
    })
  }

  items.sort((x, y) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime())
  return items.slice(0, limit)
}
