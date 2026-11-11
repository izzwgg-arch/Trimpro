import type Anthropic from '@anthropic-ai/sdk'
import { getOpenAIForImages, IMAGE_MODEL } from './config'

/**
 * The assistant's tools are thin wrappers around Trimpro's own HTTP routes,
 * called with the signed-in user's bearer token. This means:
 *   - all existing permission checks run exactly as they do for the UI, and
 *   - the assistant can never do more than that user is allowed to do.
 *
 * Sending an estimate is deliberately NOT executed by the model. prepare_send_estimate
 * only gathers the details and queues a confirmation; the actual send happens when the
 * user clicks "Send" in the panel (which calls the real /api/estimates/[id]/send route).
 */
export interface PendingConfirmation {
  type: 'send_estimate'
  estimateId: string
  estimateNumber?: string | null
  recipient?: string | null
  total?: string | null
}

export interface GeneratedImage {
  url: string
  prompt: string
}

export interface Navigation {
  path: string
  label: string
}

export interface ToolContext {
  baseUrl: string
  token: string
  pendingConfirmations: PendingConfirmation[]
  images: GeneratedImage[]
  navigation: Navigation | null
}

/** Main app sections the assistant can open. Keep paths in sync with the sidebar. */
const SECTION_PATHS: Record<string, { path: string; label: string }> = {
  dashboard: { path: '/dashboard', label: 'Dashboard' },
  production: { path: '/dashboard/production', label: 'Production' },
  estimates: { path: '/dashboard/estimates', label: 'Estimates' },
  invoices: { path: '/dashboard/invoices', label: 'Invoices' },
  credit_memos: { path: '/dashboard/credit-memos', label: 'Credit Memos' },
  jobs: { path: '/dashboard/jobs', label: 'Jobs' },
  clients: { path: '/dashboard/clients', label: 'Customers' },
  schedule: { path: '/dashboard/schedule', label: 'Schedule' },
  requests: { path: '/dashboard/requests', label: 'Requests' },
  tasks: { path: '/dashboard/tasks', label: 'Tasks' },
  purchase_orders: { path: '/dashboard/purchase-orders', label: 'Purchase Orders' },
  vendors: { path: '/dashboard/vendors', label: 'Vendors' },
  items: { path: '/dashboard/items', label: 'Items' },
  issues: { path: '/dashboard/issues', label: 'Issues' },
  teams: { path: '/dashboard/teams', label: 'Teams' },
  messages: { path: '/dashboard/messages', label: 'Messages' },
  settings: { path: '/dashboard/settings', label: 'Settings' },
}

const RECORD_PATHS: Record<string, (id: string) => string> = {
  estimate: (id) => `/dashboard/estimates/${id}`,
  invoice: (id) => `/dashboard/invoices/${id}`,
  job: (id) => `/dashboard/jobs/${id}`,
  client: (id) => `/dashboard/clients/${id}`,
  purchase_order: (id) => `/dashboard/purchase-orders/${id}`,
}

type ToolResult = { content: string; isError?: boolean }

async function api(
  ctx: ToolContext,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON response */
  }
  return { ok: res.ok, status: res.status, json, text }
}

function permissionError(status: number, json: any): ToolResult | null {
  if (status === 401 || status === 403) {
    return {
      content: JSON.stringify({
        error: 'permission_denied',
        message:
          json?.error ||
          "You don't have permission to do this in Trimpro, so the assistant can't either.",
      }),
      isError: true,
    }
  }
  return null
}

/**
 * The estimate/invoice PUT routes REPLACE the whole line-item list. To *append*
 * items we must re-send every existing line (preserving its fields, group and
 * customer-visibility flags) and add the new ones at the end. These helpers map
 * a GET response's line items back into the shape the PUT route expects, and
 * rebuild the `groups` array so existing grouped/subtotal rows survive untouched.
 */
function mapExistingLineItems(items: any[]): any[] {
  return (items || []).map((it: any) => ({
    description: it.description,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    unitCost: it.unitCost ?? null,
    isSubtotal: Boolean(it.isSubtotal),
    isVisibleToClient: it.isVisibleToClient,
    showDescriptionToCustomer: it.showDescriptionToCustomer,
    showCostToCustomer: it.showCostToCustomer,
    showPriceToCustomer: it.showPriceToCustomer,
    showTaxToCustomer: it.showTaxToCustomer,
    showNotesToCustomer: it.showNotesToCustomer,
    vendorId: it.vendorId ?? null,
    taxable: it.taxable,
    taxRate: it.taxRate ?? null,
    notes: it.notes ?? null,
    groupId: it.groupId ?? null,
    sourceItemId: it.sourceItemId ?? null,
    sourceBundleId: it.sourceBundleId ?? null,
    // Invoice-only fields; harmless/ignored on estimates.
    estimateLineTotal: it.estimateLineTotal ?? null,
    sourceEstimateLineItemId: it.sourceEstimateLineItemId ?? null,
  }))
}

/** Optional (customer-choice) items are also wiped by the PUT, so re-send them verbatim. */
function mapExistingOptionalItems(items: any[]): any[] {
  return (items || []).map((it: any) => ({
    description: it.description,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    unitCost: it.unitCost ?? null,
    isVisibleToClient: it.isVisibleToClient,
    showDescriptionToCustomer: it.showDescriptionToCustomer,
    showCostToCustomer: it.showCostToCustomer,
    showPriceToCustomer: it.showPriceToCustomer,
    showTaxToCustomer: it.showTaxToCustomer,
    showNotesToCustomer: it.showNotesToCustomer,
    vendorId: it.vendorId ?? null,
    taxable: it.taxable,
    taxRate: it.taxRate ?? null,
    notes: it.notes ?? null,
    groupId: it.groupId ?? null,
    sourceItemId: it.sourceItemId ?? null,
    sourceBundleId: it.sourceBundleId ?? null,
  }))
}

function reconstructGroups(items: any[], optionalItems: any[] = []): any[] {
  const seen = new Map<string, any>()
  for (const it of [...(items || []), ...(optionalItems || [])]) {
    if (it.groupId && it.group && !seen.has(it.groupId)) {
      seen.set(it.groupId, {
        groupId: it.groupId,
        name: it.group.name,
        sourceBundleId: it.group.sourceBundleId ?? null,
        customerDescription: it.group.customerDescription ?? null,
        customerTotal: it.group.customerTotal ?? null,
        customerEdited: Boolean(it.group.customerEdited),
      })
    }
  }
  return Array.from(seen.values())
}

/**
 * Resolve whatever the user typed for an estimate/invoice to its real database id.
 * Employees see the document NUMBER (e.g. "EST-000012" or "839886"), which is NOT
 * the internal id. We try the value as a direct id first, then fall back to a
 * number search so a typed document number always lands on the right record.
 */
function digitsOnly(s: string): string {
  return String(s ?? '').replace(/\D/g, '').replace(/^0+/, '')
}

async function resolveDocId(
  ctx: ToolContext,
  kind: 'estimate' | 'invoice',
  value: string
): Promise<{ id?: string; candidates?: any[]; status?: number; error?: string }> {
  const v = String(value ?? '').trim()
  if (!v) return { error: 'empty' }
  const base = kind === 'estimate' ? 'estimates' : 'invoices'
  const numField = kind === 'estimate' ? 'estimateNumber' : 'invoiceNumber'

  // 1) Try as a direct database id.
  const direct = await api(ctx, 'GET', `/api/${base}/${encodeURIComponent(v)}`)
  if (direct.status === 401 || direct.status === 403) return { status: direct.status, error: 'permission_denied' }
  if (direct.ok && (direct.json?.estimate || direct.json?.invoice)) return { id: v }

  // 2) Resolve by the visible document number via search.
  const list = await api(ctx, 'GET', `/api/${base}?search=${encodeURIComponent(v)}&limit=20`)
  if (list.status === 401 || list.status === 403) return { status: list.status, error: 'permission_denied' }
  const rows: any[] = (kind === 'estimate' ? list.json?.estimates : list.json?.invoices) || []
  const norm = (s: any) => String(s ?? '').trim().toLowerCase()

  // Exact number match (case-insensitive), then digits-only match (ignores EST-/INV- prefixes and leading zeros).
  let matches = rows.filter((r) => norm(r[numField]) === norm(v))
  if (matches.length === 0 && digitsOnly(v)) {
    matches = rows.filter((r) => digitsOnly(r[numField]) === digitsOnly(v))
  }
  const toCard = (m: any) => ({ id: m.id, number: m[numField], client: m.client?.name ?? null, total: m.total != null ? String(m.total) : null, status: m.status ?? null })

  if (matches.length === 1) return { id: matches[0].id }
  if (matches.length > 1) return { candidates: matches.map(toCard) }
  if (rows.length) return { candidates: rows.slice(0, 8).map(toCard) }
  return { error: 'not_found' }
}

function normalizeNewItems(raw: unknown): any[] {
  if (!Array.isArray(raw)) return []
  return raw.map((li: any) => {
    const item: any = {
      description: String(li?.description ?? ''),
      quantity: Number(li?.quantity ?? 0),
      unitPrice: Number(li?.unitPrice ?? 0),
    }
    if (li?.taxable != null) item.taxable = Boolean(li.taxable)
    if (li?.unitCost != null) item.unitCost = Number(li.unitCost)
    if (li?.notes) item.notes = String(li.notes)
    return item
  })
}

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'find_customer',
    description:
      'Search the customer (client) list by name, company, email or phone. Use this to resolve a customer to a clientId before creating or sending an estimate. Returns up to 10 matches.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, company, email or phone to search for.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_document',
    description:
      "Look up an estimate or invoice by the DOCUMENT NUMBER an employee sees (e.g. \"EST-000012\", \"839886\", \"INV-1042\") and get its real id, customer and total. ALWAYS use this to turn a number the user says into an id before add_estimate_items / add_invoice_items / prepare_send_estimate — the typed number is NOT the internal id. Returns matching records; if more than one matches, ask the user which.",
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['estimate', 'invoice'], description: 'Which kind of document.' },
        number: { type: 'string', description: 'The document number the user gave (as shown to employees).' },
      },
      required: ['type', 'number'],
    },
  },
  {
    name: 'create_estimate',
    description:
      'Create a new estimate (saved as a DRAFT). You must have a clientId (use find_customer first) and a title. Line items each have a description, quantity and unitPrice. Totals are computed by the server — do not provide them. The estimate is NOT sent to the customer.',
    input_schema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'The client/customer id from find_customer.' },
        title: { type: 'string', description: 'A short title for the estimate.' },
        lineItems: {
          type: 'array',
          description: 'The line items.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unitPrice: { type: 'number', description: 'Price per unit, in dollars.' },
            },
            required: ['description', 'quantity', 'unitPrice'],
          },
        },
        taxRate: { type: 'number', description: 'Tax rate percent, e.g. 8.875. Optional.' },
        discount: { type: 'number', description: 'Flat discount amount in dollars. Optional.' },
        jobType: { type: 'string', description: 'Optional job type label.' },
        notes: { type: 'string', description: 'Optional internal notes.' },
      },
      required: ['clientId', 'title', 'lineItems'],
    },
  },
  {
    name: 'add_estimate_items',
    description:
      "Append one or more line items to an EXISTING estimate (does not create a new one). Use this when the user wants to add items to an estimate they already have — for example items you read from an attached photo (a supplier quote, a handwritten list, a product label). Existing line items, groups and totals are preserved; the new items are added at the end and totals recalculated. You need the estimateId (the one the user currently has open is provided in context, or use find_customer/navigation context).",
    input_schema: {
      type: 'object',
      properties: {
        estimateId: { type: 'string', description: 'The id of the existing estimate to add items to.' },
        lineItems: {
          type: 'array',
          description: 'The line items to append.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unitPrice: { type: 'number', description: 'Price per unit, in dollars.' },
              taxable: { type: 'boolean', description: 'Optional. Defaults to taxable.' },
              notes: { type: 'string', description: 'Optional internal note for the line.' },
            },
            required: ['description', 'quantity', 'unitPrice'],
          },
        },
      },
      required: ['estimateId', 'lineItems'],
    },
  },
  {
    name: 'add_invoice_items',
    description:
      "Append one or more line items to an EXISTING invoice. Use this when the user wants to add items to an invoice they already have — for example items you read from an attached photo. Existing line items, groups and totals are preserved; the new items are added at the end and totals recalculated. Paid invoices cannot be edited. You need the invoiceId (the one the user currently has open is provided in context).",
    input_schema: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'The id of the existing invoice to add items to.' },
        lineItems: {
          type: 'array',
          description: 'The line items to append.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unitPrice: { type: 'number', description: 'Price per unit, in dollars.' },
              taxable: { type: 'boolean', description: 'Optional. Defaults to taxable.' },
              notes: { type: 'string', description: 'Optional internal note for the line.' },
            },
            required: ['description', 'quantity', 'unitPrice'],
          },
        },
      },
      required: ['invoiceId', 'lineItems'],
    },
  },
  {
    name: 'prepare_send_estimate',
    description:
      'Prepare to send an existing estimate to the customer. This does NOT send it — it gathers the recipient and total and asks the user to confirm. The user must click Send in the panel to actually send. Call this when the user asks to send/email an estimate.',
    input_schema: {
      type: 'object',
      properties: {
        estimateId: { type: 'string', description: 'The estimate id to send.' },
        recipientEmail: {
          type: 'string',
          description: "Optional recipient email. If omitted, the customer's email on file is used.",
        },
      },
      required: ['estimateId'],
    },
  },
  {
    name: 'schedule_job',
    description:
      "Set a job's scheduled start (and optionally end) date/time. Dates must be ISO 8601 (e.g. 2026-11-15T09:00:00). If there's a crew conflict it returns a conflict unless force is true.",
    input_schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job id to schedule.' },
        scheduledStart: { type: 'string', description: 'ISO 8601 start datetime.' },
        scheduledEnd: { type: 'string', description: 'ISO 8601 end datetime. Optional (defaults to start + 1 hour).' },
        force: { type: 'boolean', description: 'Set true to schedule despite a crew conflict.' },
      },
      required: ['jobId', 'scheduledStart'],
    },
  },
  {
    name: 'generate_image',
    description:
      'Generate a concept/marketing image from a text prompt (e.g. a railing or closet style to show a customer). The image is shown to the user in the panel. Use for concepts only — not accurate, to-scale product renderings.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to depict.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'navigate',
    description:
      "Open a screen in the app for the user. Either pass a `section` to open a main screen (e.g. production, estimates, jobs, customers, schedule), OR pass recordType + recordId to open a specific record's page (e.g. an estimate or job you just created or looked up). The app navigates immediately. Use this when the user asks to open, go to, show, or pull up a screen or record.",
    input_schema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: Object.keys(SECTION_PATHS),
          description: 'The main screen to open.',
        },
        recordType: {
          type: 'string',
          enum: Object.keys(RECORD_PATHS),
          description: 'Open a specific record of this type (requires recordId).',
        },
        recordId: { type: 'string', description: 'The id of the record to open.' },
      },
    },
  },
]

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const input = (rawInput ?? {}) as Record<string, any>
  try {
    switch (name) {
      case 'find_customer': {
        const q = String(input.query ?? '').trim()
        if (!q) return { content: JSON.stringify({ error: 'query is required' }), isError: true }
        const { ok, status, json } = await api(
          ctx,
          'GET',
          `/api/clients?search=${encodeURIComponent(q)}&limit=10`
        )
        const permErr = permissionError(status, json)
        if (permErr) return permErr
        if (!ok) return { content: JSON.stringify({ error: 'lookup_failed', status }), isError: true }
        const clients = (json?.clients ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
          companyName: c.companyName ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
        }))
        return { content: JSON.stringify({ count: clients.length, clients }) }
      }

      case 'find_document': {
        const kind = input.type === 'invoice' ? 'invoice' : 'estimate'
        const number = String(input.number ?? '').trim()
        if (!number) return { content: JSON.stringify({ error: 'number is required' }), isError: true }
        const resolved = await resolveDocId(ctx, kind, number)
        if (resolved.error === 'permission_denied') {
          return permissionError(resolved.status ?? 403, null) as ToolResult
        }
        if (resolved.id) {
          return { content: JSON.stringify({ found: true, type: kind, id: resolved.id, number }) }
        }
        if (resolved.candidates && resolved.candidates.length) {
          return {
            content: JSON.stringify({
              found: true,
              type: kind,
              multiple: resolved.candidates.length > 1,
              candidates: resolved.candidates,
              note: 'If more than one, ask the user which document they mean before acting.',
            }),
          }
        }
        return {
          content: JSON.stringify({ found: false, type: kind, number, message: `No ${kind} found matching "${number}".` }),
        }
      }

      case 'create_estimate': {
        const clientId = String(input.clientId ?? '').trim()
        const title = String(input.title ?? '').trim()
        if (!clientId) return { content: JSON.stringify({ error: 'clientId is required' }), isError: true }
        if (!title) return { content: JSON.stringify({ error: 'title is required' }), isError: true }
        const lineItems = Array.isArray(input.lineItems)
          ? input.lineItems.map((li: any) => ({
              description: String(li?.description ?? ''),
              quantity: Number(li?.quantity ?? 0),
              unitPrice: Number(li?.unitPrice ?? 0),
            }))
          : []
        const body: Record<string, any> = { clientId, title, lineItems }
        if (input.taxRate != null) body.taxRate = Number(input.taxRate)
        if (input.discount != null) body.discount = Number(input.discount)
        if (input.jobType) body.jobType = String(input.jobType)
        if (input.notes) body.notes = String(input.notes)
        const { ok, status, json } = await api(ctx, 'POST', '/api/estimates', body)
        const permErr = permissionError(status, json)
        if (permErr) return permErr
        if (!ok) {
          return {
            content: JSON.stringify({ error: 'create_failed', status, detail: json?.error ?? null }),
            isError: true,
          }
        }
        const est = json?.estimate ?? {}
        return {
          content: JSON.stringify({
            created: true,
            estimateId: est.id,
            estimateNumber: est.estimateNumber ?? null,
            total: est.total != null ? String(est.total) : null,
            status: est.status ?? 'DRAFT',
          }),
        }
      }

      case 'add_estimate_items': {
        const estimateRef = String(input.estimateId ?? '').trim()
        if (!estimateRef) return { content: JSON.stringify({ error: 'estimateId is required' }), isError: true }
        const newItems = normalizeNewItems(input.lineItems)
        if (newItems.length === 0) {
          return { content: JSON.stringify({ error: 'lineItems is required and must not be empty' }), isError: true }
        }
        // The user may have passed a document NUMBER instead of the id — resolve it.
        const resolved = await resolveDocId(ctx, 'estimate', estimateRef)
        if (resolved.error === 'permission_denied') return permissionError(resolved.status ?? 403, null) as ToolResult
        if (!resolved.id) {
          return {
            content: JSON.stringify(
              resolved.candidates?.length
                ? { error: 'ambiguous_estimate', candidates: resolved.candidates, message: 'Multiple estimates match. Ask the user which one, then call again with its id.' }
                : { error: 'estimate_not_found', message: `No estimate found matching "${estimateRef}".` }
            ),
            isError: !resolved.candidates?.length,
          }
        }
        const estimateId = resolved.id
        // Fetch current estimate so we can re-send all lines + append.
        const get = await api(ctx, 'GET', `/api/estimates/${encodeURIComponent(estimateId)}`)
        const permErr = permissionError(get.status, get.json)
        if (permErr) return permErr
        if (!get.ok || !get.json?.estimate) {
          return { content: JSON.stringify({ error: 'estimate_not_found', status: get.status }), isError: true }
        }
        const est = get.json.estimate
        const existingItems = Array.isArray(est.lineItems) ? est.lineItems : []
        const existingOptional = Array.isArray(est.optionalItems) ? est.optionalItems : []
        const body = {
          lineItems: [...mapExistingLineItems(existingItems), ...newItems],
          optionalItems: mapExistingOptionalItems(existingOptional),
          groups: reconstructGroups(existingItems, existingOptional),
        }
        const put = await api(ctx, 'PUT', `/api/estimates/${encodeURIComponent(estimateId)}`, body)
        const putPermErr = permissionError(put.status, put.json)
        if (putPermErr) return putPermErr
        if (!put.ok) {
          return {
            content: JSON.stringify({ error: 'add_items_failed', status: put.status, detail: put.json?.error ?? null }),
            isError: true,
          }
        }
        const updated = put.json?.estimate ?? {}
        return {
          content: JSON.stringify({
            added: true,
            estimateId,
            estimateNumber: updated.estimateNumber ?? est.estimateNumber ?? null,
            itemsAdded: newItems.length,
            newTotal: updated.total != null ? String(updated.total) : null,
            note: 'Items were added to the estimate. Tell the user what you added and the new total. Offer to open the estimate (navigate recordType=estimate).',
          }),
        }
      }

      case 'add_invoice_items': {
        const invoiceRef = String(input.invoiceId ?? '').trim()
        if (!invoiceRef) return { content: JSON.stringify({ error: 'invoiceId is required' }), isError: true }
        const newItems = normalizeNewItems(input.lineItems)
        if (newItems.length === 0) {
          return { content: JSON.stringify({ error: 'lineItems is required and must not be empty' }), isError: true }
        }
        const resolved = await resolveDocId(ctx, 'invoice', invoiceRef)
        if (resolved.error === 'permission_denied') return permissionError(resolved.status ?? 403, null) as ToolResult
        if (!resolved.id) {
          return {
            content: JSON.stringify(
              resolved.candidates?.length
                ? { error: 'ambiguous_invoice', candidates: resolved.candidates, message: 'Multiple invoices match. Ask the user which one, then call again with its id.' }
                : { error: 'invoice_not_found', message: `No invoice found matching "${invoiceRef}".` }
            ),
            isError: !resolved.candidates?.length,
          }
        }
        const invoiceId = resolved.id
        const get = await api(ctx, 'GET', `/api/invoices/${encodeURIComponent(invoiceId)}`)
        const permErr = permissionError(get.status, get.json)
        if (permErr) return permErr
        if (!get.ok || !get.json?.invoice) {
          return { content: JSON.stringify({ error: 'invoice_not_found', status: get.status }), isError: true }
        }
        const inv = get.json.invoice
        const existingItems = Array.isArray(inv.lineItems) ? inv.lineItems : []
        const existingOptional = Array.isArray(inv.optionalItems) ? inv.optionalItems : []
        const body = {
          lineItems: [...mapExistingLineItems(existingItems), ...newItems],
          optionalItems: mapExistingOptionalItems(existingOptional),
          groups: reconstructGroups(existingItems, existingOptional),
        }
        const put = await api(ctx, 'PUT', `/api/invoices/${encodeURIComponent(invoiceId)}`, body)
        const putPermErr = permissionError(put.status, put.json)
        if (putPermErr) return putPermErr
        if (put.status === 400 && /paid/i.test(String(put.json?.error ?? ''))) {
          return {
            content: JSON.stringify({
              error: 'invoice_paid',
              message: 'This invoice is already paid and cannot be edited. Tell the user.',
            }),
          }
        }
        if (!put.ok) {
          return {
            content: JSON.stringify({ error: 'add_items_failed', status: put.status, detail: put.json?.error ?? null }),
            isError: true,
          }
        }
        const updated = put.json?.invoice ?? {}
        return {
          content: JSON.stringify({
            added: true,
            invoiceId,
            invoiceNumber: updated.invoiceNumber ?? inv.invoiceNumber ?? null,
            itemsAdded: newItems.length,
            newTotal: updated.total != null ? String(updated.total) : null,
            note: 'Items were added to the invoice. Tell the user what you added and the new total. Offer to open the invoice (navigate recordType=invoice).',
          }),
        }
      }

      case 'prepare_send_estimate': {
        const estimateRef = String(input.estimateId ?? '').trim()
        if (!estimateRef) return { content: JSON.stringify({ error: 'estimateId is required' }), isError: true }
        // The user may have given a document NUMBER — resolve it to the real id.
        const resolvedSend = await resolveDocId(ctx, 'estimate', estimateRef)
        if (resolvedSend.error === 'permission_denied') return permissionError(resolvedSend.status ?? 403, null) as ToolResult
        if (!resolvedSend.id) {
          return {
            content: JSON.stringify(
              resolvedSend.candidates?.length
                ? { error: 'ambiguous_estimate', candidates: resolvedSend.candidates, message: 'Multiple estimates match. Ask the user which one.' }
                : { error: 'estimate_not_found', message: `No estimate found matching "${estimateRef}".` }
            ),
            isError: !resolvedSend.candidates?.length,
          }
        }
        const estimateId = resolvedSend.id
        // Best-effort fetch of details for the confirmation card (don't fail if it 404s).
        let estimateNumber: string | null = null
        let total: string | null = null
        let recipient: string | null = input.recipientEmail ? String(input.recipientEmail) : null
        const { ok, json } = await api(ctx, 'GET', `/api/estimates/${encodeURIComponent(estimateId)}`)
        if (ok && json) {
          const est = json.estimate ?? json
          estimateNumber = est?.estimateNumber ?? null
          total = est?.total != null ? String(est.total) : null
          if (!recipient) recipient = est?.client?.email ?? null
        }
        ctx.pendingConfirmations.push({
          type: 'send_estimate',
          estimateId,
          estimateNumber,
          recipient,
          total,
        })
        return {
          content: JSON.stringify({
            prepared: true,
            awaiting_user_confirmation: true,
            estimateNumber,
            recipient: recipient ?? "the customer's email on file",
            note:
              'A confirmation with a Send button is now shown to the user. Tell the user it is ready and ask them to click Send. Do NOT claim it has been sent.',
          }),
        }
      }

      case 'schedule_job': {
        const jobId = String(input.jobId ?? '').trim()
        const scheduledStart = String(input.scheduledStart ?? '').trim()
        if (!jobId) return { content: JSON.stringify({ error: 'jobId is required' }), isError: true }
        if (!scheduledStart) return { content: JSON.stringify({ error: 'scheduledStart is required' }), isError: true }
        const body: Record<string, any> = { scheduledStart }
        if (input.scheduledEnd) body.scheduledEnd = String(input.scheduledEnd)
        if (input.force) body.force = true
        const { ok, status, json } = await api(
          ctx,
          'PATCH',
          `/api/jobs/${encodeURIComponent(jobId)}/schedule`,
          body
        )
        const permErr = permissionError(status, json)
        if (permErr) return permErr
        if (status === 409) {
          return {
            content: JSON.stringify({
              error: 'schedule_conflict',
              message:
                'There is a crew scheduling conflict. Ask the user if they want to schedule anyway (then call again with force: true).',
            }),
          }
        }
        if (!ok) {
          return {
            content: JSON.stringify({ error: 'schedule_failed', status, detail: json?.error ?? null }),
            isError: true,
          }
        }
        return { content: JSON.stringify({ scheduled: true, jobId, scheduledStart, scheduledEnd: body.scheduledEnd ?? null }) }
      }

      case 'generate_image': {
        const prompt = String(input.prompt ?? '').trim()
        if (!prompt) return { content: JSON.stringify({ error: 'prompt is required' }), isError: true }
        const openai = getOpenAIForImages()
        if (!openai) {
          return {
            content: JSON.stringify({
              error: 'image_generation_unavailable',
              message:
                'Image generation is not configured (no OPENAI_API_KEY). Tell the user image generation needs to be set up.',
            }),
            isError: true,
          }
        }
        const result = await openai.images.generate({
          model: IMAGE_MODEL,
          prompt,
          size: '1024x1024',
          n: 1,
        })
        const b64 = result.data?.[0]?.b64_json
        if (!b64) {
          return { content: JSON.stringify({ error: 'image_generation_failed' }), isError: true }
        }
        const buffer = Buffer.from(b64, 'base64')
        const form = new FormData()
        form.append('file', new Blob([buffer], { type: 'image/png' }), `ai-image-${Date.now()}.png`)
        const uploadRes = await fetch(`${ctx.baseUrl}/api/uploads`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ctx.token}` },
          body: form,
        })
        const uploadJson: any = await uploadRes.json().catch(() => null)
        if (!uploadRes.ok || !uploadJson?.url) {
          const permErr = permissionError(uploadRes.status, uploadJson)
          if (permErr) return permErr
          return { content: JSON.stringify({ error: 'image_upload_failed', status: uploadRes.status }), isError: true }
        }
        ctx.images.push({ url: uploadJson.url, prompt })
        return {
          content: JSON.stringify({
            generated: true,
            imageUrl: uploadJson.url,
            note: 'The image is displayed to the user in the panel.',
          }),
        }
      }

      case 'navigate': {
        const recordType = input.recordType ? String(input.recordType) : ''
        const recordId = input.recordId ? String(input.recordId) : ''
        const section = input.section ? String(input.section) : ''

        if (recordType && recordId) {
          const builder = RECORD_PATHS[recordType]
          if (!builder) {
            return {
              content: JSON.stringify({ error: 'unknown_record_type', recordType }),
              isError: true,
            }
          }
          const path = builder(encodeURIComponent(recordId))
          const label = `${recordType} ${recordId}`
          ctx.navigation = { path, label }
          return { content: JSON.stringify({ navigated: true, path, note: 'The app is opening this page now.' }) }
        }

        const dest = SECTION_PATHS[section]
        if (!dest) {
          return {
            content: JSON.stringify({
              error: 'unknown_section',
              message: 'Provide a known section, or recordType + recordId.',
              availableSections: Object.keys(SECTION_PATHS),
            }),
            isError: true,
          }
        }
        ctx.navigation = { path: dest.path, label: dest.label }
        return { content: JSON.stringify({ navigated: true, path: dest.path, section: dest.label, note: 'The app is opening this screen now.' }) }
      }

      default:
        return { content: JSON.stringify({ error: `unknown tool: ${name}` }), isError: true }
    }
  } catch (err: any) {
    return {
      content: JSON.stringify({ error: 'tool_exception', message: String(err?.message ?? err) }),
      isError: true,
    }
  }
}
