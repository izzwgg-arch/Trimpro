/**
 * Global search — business/workflow data only.
 *
 * Searches: clients, contacts, vendors, estimates, invoices, credit memos,
 *           payments, purchase orders, items, jobs (incl. job site address),
 *           requests, measuring requests, tasks, issues, schedules, team
 *           members, calls, attachments, notes.
 *
 * Excludes: permissions, roles, integrations, logs, settings, system config.
 *
 * Tenant isolation is enforced on every query; permission gating matches
 * what the sidebar already enforces.
 */

import { prisma } from '@/lib/prisma'
import { formatAddressParts } from '@/lib/address/parse'
import { hasPermissionKey } from '@/lib/permission-aliases'
import { computeScore, topN, queryVariants } from './scoring'
import { issueScopeWhere, jobScopeWhere, leadScopeWhere, scheduleScopeWhere, taskScopeWhere } from '@/lib/assignments/scope'

export type { RawResult as SearchResult } from './scoring'

export interface SearchGroup {
  type: string
  label: string
  results: Array<{
    id: string
    entityType: string
    title: string
    subtitle: string
    url: string
    score: number
    updatedAt?: Date | null
  }>
}

// ---- helpers ----------------------------------------------------------------

const ilike = (s: string) => ({ contains: s, mode: 'insensitive' as const })

/** Build an OR filter covering all synonyms for better recall. */
function ilikeAny(field: string, terms: string[]): Record<string, unknown>[] {
  return terms.map((t) => ({ [field]: ilike(t) }))
}

/** Collect all descendant sub-client IDs below the given parent client IDs. */
async function getDescendantClientIds(
  tenantId: string,
  parentIds: string[]
): Promise<string[]> {
  const all = new Set<string>()
  let frontier = [...parentIds]
  while (frontier.length > 0) {
    const children = await prisma.client.findMany({
      where: { tenantId, isActive: true, parentId: { in: frontier } },
      select: { id: true },
    })
    frontier = []
    for (const child of children) {
      if (!all.has(child.id)) {
        all.add(child.id)
        frontier.push(child.id)
      }
    }
  }
  return Array.from(all)
}

/** Score related records so they surface when a parent client matched the query. */
function relatedScore(baseScore: number, updatedAt?: Date | null): number {
  let recency = 0
  if (updatedAt) {
    const days = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000
    if (days < 7) recency = 15
    else if (days < 30) recency = 10
    else if (days < 90) recency = 5
  }
  return Math.round(baseScore * 0.85 + recency)
}

type AddressParts = {
  street?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
}

function resolveEstimateAddress(estimate: {
  jobSiteAddress?: string | null
  job?: { addresses?: AddressParts[] } | null
}): string {
  const fromJob = formatAddressParts(estimate.job?.addresses?.[0])
  if (fromJob) return fromJob
  return estimate.jobSiteAddress?.trim() || ''
}

function resolveInvoiceAddress(invoice: {
  job?: { addresses?: AddressParts[] } | null
  estimate?: { jobSiteAddress?: string | null } | null
}): string {
  const fromJob = formatAddressParts(invoice.job?.addresses?.[0])
  if (fromJob) return fromJob
  return invoice.estimate?.jobSiteAddress?.trim() || ''
}

/** Address match (street / city / zip) for an `addresses` relation. */
function addressMatch(terms: string[]) {
  return {
    addresses: {
      some: { OR: [...ilikeAny('street', terms), ...ilikeAny('city', terms), ...ilikeAny('zipCode', terms)] },
    },
  }
}

/** AND-wrap a scope fragment so it can sit next to a where that has its own OR. */
function scoped(fragment: Record<string, unknown> | undefined) {
  return fragment && Object.keys(fragment).length > 0 ? { AND: [fragment] } : {}
}

const AUTO_SCHEDULE_MARKER = '[AUTO_JOB_SCHEDULE]'

const estimateInclude = {
  client: { select: { name: true, companyName: true } },
  job: {
    select: {
      addresses: {
        where: { type: 'job_site' as const },
        select: { street: true, city: true, state: true, zipCode: true },
        take: 1,
      },
    },
  },
}

const invoiceInclude = {
  client: { select: { name: true, companyName: true } },
  job: {
    select: {
      addresses: {
        where: { type: 'job_site' as const },
        select: { street: true, city: true, state: true, zipCode: true },
        take: 1,
      },
    },
  },
  estimate: { select: { jobSiteAddress: true } },
}

// ---- main export ------------------------------------------------------------

export async function runGlobalSearch({
  query,
  tenantId,
  permissions,
  limitPerGroup = 8,
  assignedOnly,
}: {
  query: string
  tenantId: string
  permissions: string[]
  limitPerGroup?: number
  /** "See only assigned ..." restrictions for this person (user id when they apply). */
  assignedOnly?: {
    jobsUserId?: string
    tasksUserId?: string
    leadsUserId?: string
    issuesUserId?: string
    scheduleUserId?: string
  }
}): Promise<SearchGroup[]> {
  const q = query.trim()
  if (!q || q.length < 2) return []

  const can = (key: string) => hasPermissionKey(permissions, key)
  const terms = queryVariants(q) // synonyms + digit forms
  const fetch = limitPerGroup * 2 // fetch 2× then score/slice
  const jobScope = assignedOnly?.jobsUserId ? jobScopeWhere(assignedOnly.jobsUserId) : {}
  const taskScope = scoped(assignedOnly?.tasksUserId ? taskScopeWhere(assignedOnly.tasksUserId) : undefined)
  const leadScope = scoped(assignedOnly?.leadsUserId ? leadScopeWhere(assignedOnly.leadsUserId) : undefined)
  const issueScope = scoped(assignedOnly?.issuesUserId ? issueScopeWhere(assignedOnly.issuesUserId) : undefined)
  const scheduleScope = scoped(assignedOnly?.scheduleUserId ? scheduleScopeWhere(assignedOnly.scheduleUserId) : undefined)
  const clientName = { client: { OR: [...ilikeAny('name', [q]), ...ilikeAny('companyName', [q])] } }
  const jobRef = { job: { OR: [...ilikeAny('jobNumber', terms), ...ilikeAny('title', terms)] } }

  // ── parallel queries ──────────────────────────────────────────────────────
  const [
    clientRows,
    contactRows,
    vendorRows,
    estimateRows,
    invoiceRows,
    paymentRows,
    poRows,
    itemRows,
    jobRows,
    taskRows,
    attachmentRows,
    noteRows,
    leadRows,
    issueRows,
    scheduleRows,
    creditMemoRows,
    measuringRows,
    userRows,
    callRows,
  ] = await Promise.all([
    // Clients
    can('clients.view')
      ? prisma.client.findMany({
          where: {
            tenantId,
            isActive: true,
            OR: [
              ...ilikeAny('name', terms),
              ...ilikeAny('companyName', terms),
              ...ilikeAny('email', terms),
              ...ilikeAny('phone', terms),
              addressMatch(terms),
            ],
          },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Contacts (returned inside Customers group)
    can('clients.view')
      ? prisma.contact.findMany({
          where: {
            client: { tenantId, isActive: true },
            OR: [
              ...ilikeAny('firstName', terms),
              ...ilikeAny('lastName', terms),
              ...ilikeAny('email', terms),
              ...ilikeAny('phone', terms),
            ],
          },
          include: { client: { select: { id: true, name: true, companyName: true } } },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Vendors
    can('purchase_orders.view')
      ? prisma.vendor.findMany({
          where: {
            tenantId,
            OR: [
              ...ilikeAny('name', terms),
              ...ilikeAny('email', terms),
              ...ilikeAny('phone', terms),
              ...ilikeAny('vendorCode', terms),
            ],
          },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Estimates
    can('estimates.view')
      ? prisma.estimate.findMany({
          where: {
            tenantId,
            OR: [
              ...ilikeAny('estimateNumber', terms),
              ...ilikeAny('title', terms),
              ...ilikeAny('notes', terms),
              ...ilikeAny('jobSiteAddress', terms),
              { job: addressMatch(terms) },
              { client: { OR: [...ilikeAny('name', terms), ...ilikeAny('companyName', terms)] } },
              { job: { OR: [...ilikeAny('jobNumber', terms), ...ilikeAny('title', terms)] } },
            ],
          },
          include: estimateInclude,
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Invoices
    can('invoices.view')
      ? prisma.invoice.findMany({
          where: {
            tenantId,
            OR: [
              ...ilikeAny('invoiceNumber', terms),
              ...ilikeAny('title', terms),
              ...ilikeAny('notes', terms),
              ...ilikeAny('memo', terms),
              { client: { OR: [...ilikeAny('name', terms), ...ilikeAny('companyName', terms)] } },
              { job: { OR: [...ilikeAny('jobNumber', terms), ...ilikeAny('title', terms)] } },
              { job: addressMatch(terms) },
            ],
          },
          include: invoiceInclude,
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Payments (tenant-isolated through invoice relation)
    can('payments.view')
      ? prisma.payment.findMany({
          where: {
            invoice: { tenantId },
            OR: [
              ...ilikeAny('reference', terms),
              ...ilikeAny('notes', terms),
            ],
          },
          include: {
            invoice: { select: { id: true, invoiceNumber: true, client: { select: { name: true } } } },
          },
          take: fetch,
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),

    // Purchase Orders
    can('purchase_orders.view')
      ? prisma.purchaseOrder.findMany({
          where: {
            tenantId,
            OR: [
              ...ilikeAny('poNumber', terms),
              ...ilikeAny('vendor', terms),
            ],
          },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Items / Products / Materials
    can('settings.view')
      ? prisma.item.findMany({
          where: {
            tenantId,
            OR: [
              ...ilikeAny('name', terms),
              ...ilikeAny('sku', terms),
              ...ilikeAny('description', terms),
            ],
          },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Jobs / Projects
    can('jobs.view')
      ? prisma.job.findMany({
          where: {
            tenantId,
            ...jobScope,
            OR: [
              ...ilikeAny('jobNumber', terms),
              ...ilikeAny('title', terms),
              ...ilikeAny('description', terms),
              addressMatch(terms),
              {
                client: {
                  OR: [
                    ...ilikeAny('name', terms),
                    ...ilikeAny('companyName', terms),
                  ],
                },
              },
            ],
          },
          include: {
            client: { select: { name: true, companyName: true } },
            addresses: {
              where: { type: 'job_site' },
              select: { street: true, city: true, state: true, zipCode: true },
              take: 1,
            },
          },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Tasks
    can('tasks.view')
      ? prisma.task.findMany({
          where: {
            tenantId,
            ...taskScope,
            OR: [
              ...ilikeAny('title', terms),
              ...ilikeAny('description', terms),
              jobRef,
              { job: clientName },
            ],
          },
          include: { job: { select: { jobNumber: true, title: true } } },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Attachments / Files — tenant isolation via related entity
    prisma.attachment.findMany({
      where: {
        fileName: ilike(q),
        OR: assignedOnly?.jobsUserId
          ? [{ job: { tenantId, ...jobScope } }]
          : [
              { client: { tenantId } },
              { job: { tenantId } },
              { estimate: { tenantId } },
              { invoice: { tenantId } },
              { purchaseOrder: { tenantId } },
              { vendor: { tenantId } },
              { task: { tenantId } },
              { issue: { tenantId } },
              { lead: { tenantId } },
            ],
      },
      include: {
        client: { select: { id: true, name: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
        estimate: { select: { id: true, estimateNumber: true } },
        job: { select: { id: true, jobNumber: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        vendor: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        issue: { select: { id: true, title: true } },
        lead: { select: { id: true, firstName: true, lastName: true, company: true } },
      },
      take: fetch,
      orderBy: { createdAt: 'desc' },
    }),

    // Notes — tenant isolation via client or job relation
    prisma.note.findMany({
      where: {
        content: ilike(q),
        OR: assignedOnly?.jobsUserId
          ? [{ job: { tenantId, ...jobScope } }]
          : [{ client: { tenantId } }, { job: { tenantId } }],
      },
      include: {
        client: { select: { id: true, name: true, companyName: true } },
        job: { select: { id: true, jobNumber: true, title: true } },
      },
      take: fetch,
      orderBy: { updatedAt: 'desc' },
    }),

    // Requests (leads)
    can('leads.view')
      ? prisma.lead.findMany({
          where: {
            tenantId,
            ...leadScope,
            OR: [
              ...ilikeAny('firstName', terms),
              ...ilikeAny('lastName', terms),
              ...ilikeAny('company', terms),
              ...ilikeAny('email', terms),
              ...ilikeAny('phone', terms),
              ...ilikeAny('notes', terms),
              ...ilikeAny('jobSiteAddress', terms),
            ],
          },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Issues
    can('issues.view')
      ? prisma.issue.findMany({
          where: {
            tenantId,
            ...issueScope,
            OR: [
              ...ilikeAny('title', terms),
              ...ilikeAny('description', terms),
              jobRef,
              clientName,
            ],
          },
          include: { job: { select: { jobNumber: true, title: true } } },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Schedules (made by hand; the automatic crew copies are left out)
    can('schedule.view')
      ? prisma.schedule.findMany({
          where: {
            tenantId,
            ...scheduleScope,
            NOT: { description: { startsWith: AUTO_SCHEDULE_MARKER } },
            OR: [
              ...ilikeAny('title', terms),
              ...ilikeAny('description', terms),
              jobRef,
              { user: { OR: [...ilikeAny('firstName', terms), ...ilikeAny('lastName', terms)] } },
            ],
          },
          include: {
            user: { select: { firstName: true, lastName: true } },
            job: { select: { jobNumber: true, title: true } },
          },
          take: fetch,
          orderBy: { startTime: 'desc' },
        })
      : Promise.resolve([]),

    // Credit memos
    can('invoices.view')
      ? prisma.creditMemo.findMany({
          where: {
            tenantId,
            OR: [
              ...ilikeAny('creditMemoNumber', terms),
              ...ilikeAny('title', terms),
              ...ilikeAny('notes', terms),
              ...ilikeAny('memo', terms),
              { client: { OR: [...ilikeAny('name', terms), ...ilikeAny('companyName', terms)] } },
            ],
          },
          include: { client: { select: { name: true, companyName: true } } },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Measuring requests (searched by their notes or the request they belong to)
    can('leads.view')
      ? prisma.measuringRequest.findMany({
          where: {
            tenantId,
            ...(assignedOnly?.leadsUserId ? { assignedUserId: assignedOnly.leadsUserId } : {}),
            OR: [
              ...ilikeAny('notes', terms),
              {
                request: {
                  OR: [
                    ...ilikeAny('firstName', terms),
                    ...ilikeAny('lastName', terms),
                    ...ilikeAny('company', terms),
                    ...ilikeAny('jobSiteAddress', terms),
                  ],
                },
              },
            ],
          },
          include: {
            request: { select: { id: true, firstName: true, lastName: true, company: true, jobSiteAddress: true } },
            assignedUser: { select: { firstName: true, lastName: true } },
          },
          take: fetch,
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),

    // Team members
    can('users.view') || can('teams.view')
      ? prisma.user.findMany({
          where: {
            tenantId,
            OR: [
              ...ilikeAny('firstName', terms),
              ...ilikeAny('lastName', terms),
              ...ilikeAny('email', terms),
              ...ilikeAny('phone', terms),
            ],
          },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true, updatedAt: true },
          take: fetch,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),

    // Calls (by phone number)
    can('calls.view')
      ? prisma.call.findMany({
          where: {
            tenantId,
            OR: [...ilikeAny('fromNumber', terms), ...ilikeAny('toNumber', terms)],
          },
          include: { client: { select: { id: true, name: true } } },
          take: fetch,
          orderBy: { startedAt: 'desc' },
        })
      : Promise.resolve([]),
  ])

  // ── related entities for matched clients ──────────────────────────────────
  const matchedClientIds = new Set<string>()
  let maxClientScore = 0

  for (const c of clientRows as any[]) {
    matchedClientIds.add(c.id)
    maxClientScore = Math.max(
      maxClientScore,
      computeScore(q, [c.name, c.companyName], [c.email, c.phone], c.updatedAt)
    )
  }
  for (const ct of contactRows as any[]) {
    if (ct.client?.id) {
      matchedClientIds.add(ct.client.id)
      const fullName = `${ct.firstName} ${ct.lastName}`.trim()
      maxClientScore = Math.max(
        maxClientScore,
        computeScore(q, [ct.firstName, ct.lastName, fullName], [ct.email, ct.phone], ct.updatedAt)
      )
    }
  }

  const rootClientIds = Array.from(matchedClientIds)
  const descendantClientIds =
    rootClientIds.length > 0 && can('clients.view')
      ? await getDescendantClientIds(tenantId, rootClientIds)
      : []
  const relatedClientIds = Array.from(new Set([...rootClientIds, ...descendantClientIds]))

  const [subClientRows, relatedEstimateRows, relatedInvoiceRows, relatedJobRows] =
    relatedClientIds.length > 0
      ? await Promise.all([
          descendantClientIds.length > 0 && can('clients.view')
            ? prisma.client.findMany({
                where: {
                  tenantId,
                  isActive: true,
                  id: { in: descendantClientIds },
                },
                include: {
                  parent: { select: { name: true, companyName: true } },
                },
                take: fetch,
                orderBy: { updatedAt: 'desc' },
              })
            : Promise.resolve([]),
          can('estimates.view')
            ? prisma.estimate.findMany({
                where: { tenantId, clientId: { in: relatedClientIds } },
                include: estimateInclude,
                take: fetch,
                orderBy: { updatedAt: 'desc' },
              })
            : Promise.resolve([]),
          can('invoices.view')
            ? prisma.invoice.findMany({
                where: { tenantId, clientId: { in: relatedClientIds } },
                include: invoiceInclude,
                take: fetch,
                orderBy: { updatedAt: 'desc' },
              })
            : Promise.resolve([]),
          can('jobs.view')
            ? prisma.job.findMany({
                where: { tenantId, ...jobScope, clientId: { in: relatedClientIds } },
                include: {
                  client: { select: { name: true, companyName: true } },
                  addresses: {
                    where: { type: 'job_site' },
                    select: { street: true, city: true, state: true, zipCode: true },
                    take: 1,
                  },
                },
                take: fetch,
                orderBy: { updatedAt: 'desc' },
              })
            : Promise.resolve([]),
        ])
      : [[], [], [], []]

  // ── map rows → scored results ─────────────────────────────────────────────
  const groups: SearchGroup[] = []

  // --- Customers (clients + contacts merged, deduped by client id) ----------
  const customerMap = new Map<string, SearchGroup['results'][0]>()

  for (const c of clientRows as any[]) {
    const sc = computeScore(q, [c.name, c.companyName], [c.email, c.phone], c.updatedAt)
    customerMap.set(c.id, {
      id: c.id,
      entityType: 'client',
      title: c.companyName || c.name,
      subtitle: [c.email, c.phone].filter(Boolean).join(' · ') || 'Customer',
      url: `/dashboard/clients/${c.id}`,
      score: sc,
      updatedAt: c.updatedAt,
    })
  }

  for (const ct of contactRows as any[]) {
    const fullName = `${ct.firstName} ${ct.lastName}`.trim()
    const clientId = ct.client?.id
    const sc = computeScore(q, [ct.firstName, ct.lastName, fullName], [ct.email, ct.phone], ct.updatedAt)
    // If the client is already in the map give it a score boost but don't add duplicate
    if (clientId && customerMap.has(clientId)) {
      const existing = customerMap.get(clientId)!
      existing.score = Math.max(existing.score, sc)
      if (!existing.subtitle.includes(fullName)) {
        existing.subtitle = `${fullName} · ${existing.subtitle}`.slice(0, 80)
      }
    } else {
      customerMap.set(ct.id, {
        id: ct.id,
        entityType: 'contact',
        title: fullName,
        subtitle: `Contact at ${ct.client?.companyName || ct.client?.name || ''}`,
        url: clientId ? `/dashboard/clients/${clientId}` : '#',
        score: sc,
        updatedAt: ct.updatedAt,
      })
    }
  }

  for (const sc of subClientRows as any[]) {
    if (customerMap.has(sc.id)) continue
    const parentLabel = sc.parent?.companyName || sc.parent?.name || 'parent client'
    customerMap.set(sc.id, {
      id: sc.id,
      entityType: 'client',
      title: sc.companyName || sc.name,
      subtitle: `Sub-client of ${parentLabel}`,
      url: `/dashboard/clients/${sc.id}`,
      score: relatedScore(maxClientScore, sc.updatedAt),
      updatedAt: sc.updatedAt,
    })
  }

  const customerResults = topN(Array.from(customerMap.values()), limitPerGroup)
  if (customerResults.length > 0) {
    groups.push({ type: 'customer', label: 'Customers', results: customerResults })
  }

  // --- Vendors --------------------------------------------------------------
  const vendorResults = topN(
    (vendorRows as any[]).map((v) => ({
      id: v.id,
      entityType: 'vendor',
      title: v.name,
      subtitle: [v.vendorCode, v.email, v.phone].filter(Boolean).join(' · ') || 'Vendor',
      url: `/dashboard/vendors/${v.id}`,
      score: computeScore(q, [v.name, v.vendorCode], [v.email, v.phone], v.updatedAt),
      updatedAt: v.updatedAt,
    })),
    limitPerGroup
  )
  if (vendorResults.length > 0) {
    groups.push({ type: 'vendor', label: 'Vendors', results: vendorResults })
  }

  // --- Estimates ------------------------------------------------------------
  const estimateMap = new Map<string, SearchGroup['results'][0]>()
  const mapEstimate = (e: any, score: number) => {
    const address = resolveEstimateAddress(e)
    const clientLabel = e.client?.companyName || e.client?.name
    estimateMap.set(e.id, {
      id: e.id,
      entityType: 'estimate',
      title: `${e.estimateNumber} — ${e.title}`,
      subtitle: [address, clientLabel].filter(Boolean).join(' · ') || e.status,
      url: `/dashboard/estimates/${e.id}`,
      score,
      updatedAt: e.updatedAt,
    })
  }
  for (const e of estimateRows as any[]) {
    mapEstimate(
      e,
      computeScore(
        q,
        [e.estimateNumber, e.title],
        [e.notes, e.client?.name, e.client?.companyName, resolveEstimateAddress(e)],
        e.updatedAt
      )
    )
  }
  for (const e of relatedEstimateRows as any[]) {
    if (estimateMap.has(e.id)) continue
    mapEstimate(e, relatedScore(maxClientScore, e.updatedAt))
  }
  const estimateResults = topN(Array.from(estimateMap.values()), limitPerGroup)
  if (estimateResults.length > 0) {
    groups.push({ type: 'estimate', label: 'Estimates', results: estimateResults })
  }

  // --- Invoices -------------------------------------------------------------
  const invoiceMap = new Map<string, SearchGroup['results'][0]>()
  const mapInvoice = (inv: any, score: number) => {
    const address = resolveInvoiceAddress(inv)
    const clientLabel = inv.client?.companyName || inv.client?.name
    invoiceMap.set(inv.id, {
      id: inv.id,
      entityType: 'invoice',
      title: `${inv.invoiceNumber} — ${inv.title}`,
      subtitle: [address, clientLabel].filter(Boolean).join(' · ') || inv.status,
      url: `/dashboard/invoices/${inv.id}`,
      score,
      updatedAt: inv.updatedAt,
    })
  }
  for (const inv of invoiceRows as any[]) {
    mapInvoice(
      inv,
      computeScore(
        q,
        [inv.invoiceNumber, inv.title],
        [inv.notes, inv.memo, inv.client?.name, resolveInvoiceAddress(inv)],
        inv.updatedAt
      )
    )
  }
  for (const inv of relatedInvoiceRows as any[]) {
    if (invoiceMap.has(inv.id)) continue
    mapInvoice(inv, relatedScore(maxClientScore, inv.updatedAt))
  }
  const invoiceResults = topN(Array.from(invoiceMap.values()), limitPerGroup)
  if (invoiceResults.length > 0) {
    groups.push({ type: 'invoice', label: 'Invoices', results: invoiceResults })
  }

  // --- Payments -------------------------------------------------------------
  const paymentResults = topN(
    (paymentRows as any[]).map((p) => ({
      id: p.id,
      entityType: 'payment',
      title: p.reference
        ? `Payment ${p.reference}`
        : `Payment on ${p.invoice?.invoiceNumber ?? ''}`,
      subtitle: [
        String(p.method).replace(/_/g, ' '),
        `$${Number(p.amount).toFixed(2)}`,
        p.status,
      ].join(' · '),
      url: `/dashboard/invoices/${p.invoice?.id ?? p.invoiceId}`,
      score: computeScore(q, [p.reference, p.invoice?.invoiceNumber], [p.notes], p.createdAt),
      updatedAt: p.createdAt,
    })),
    limitPerGroup
  )
  if (paymentResults.length > 0) {
    groups.push({ type: 'payment', label: 'Payments', results: paymentResults })
  }

  // --- Purchase Orders ------------------------------------------------------
  const poResults = topN(
    (poRows as any[]).map((po) => ({
      id: po.id,
      entityType: 'purchaseOrder',
      title: po.poNumber,
      subtitle: `${po.vendor} · ${po.status}`,
      url: `/dashboard/purchase-orders/${po.id}`,
      score: computeScore(q, [po.poNumber, po.vendor], [], po.updatedAt),
      updatedAt: po.updatedAt,
    })),
    limitPerGroup
  )
  if (poResults.length > 0) {
    groups.push({ type: 'purchaseOrder', label: 'Purchase Orders', results: poResults })
  }

  // --- Items ----------------------------------------------------------------
  const itemResults = topN(
    (itemRows as any[]).map((item) => ({
      id: item.id,
      entityType: 'item',
      title: item.name,
      subtitle: [item.sku, item.type, (item.description ?? '').slice(0, 50)]
        .filter(Boolean)
        .join(' · '),
      url: `/dashboard/items`,
      score: computeScore(q, [item.name, item.sku], [item.description, item.notes], item.updatedAt),
      updatedAt: item.updatedAt,
    })),
    limitPerGroup
  )
  if (itemResults.length > 0) {
    groups.push({ type: 'item', label: 'Items', results: itemResults })
  }

  // --- Projects / Jobs ------------------------------------------------------
  const jobMap = new Map<string, SearchGroup['results'][0]>()
  const mapJob = (job: any, score: number) => {
    const jobSiteAddress = formatAddressParts(job.addresses?.[0])
    const clientLabel = job.client?.companyName || job.client?.name
    jobMap.set(job.id, {
      id: job.id,
      entityType: 'job',
      title: `${job.jobNumber} — ${job.title}`,
      subtitle: [jobSiteAddress, clientLabel].filter(Boolean).join(' · ') || job.status,
      url: `/dashboard/jobs/${job.id}`,
      score,
      updatedAt: job.updatedAt,
    })
  }
  for (const job of jobRows as any[]) {
    const jobSiteAddress = formatAddressParts(job.addresses?.[0])
    mapJob(
      job,
      computeScore(
        q,
        [job.jobNumber, job.title],
        [job.description, job.client?.name, job.client?.companyName, jobSiteAddress],
        job.updatedAt
      )
    )
  }
  for (const job of relatedJobRows as any[]) {
    if (jobMap.has(job.id)) continue
    mapJob(job, relatedScore(maxClientScore, job.updatedAt))
  }
  const jobResults = topN(Array.from(jobMap.values()), limitPerGroup)
  if (jobResults.length > 0) {
    groups.push({ type: 'job', label: 'Projects', results: jobResults })
  }

  // --- Tasks ----------------------------------------------------------------
  const taskResults = topN(
    (taskRows as any[]).map((task) => ({
      id: task.id,
      entityType: 'task',
      title: task.title,
      subtitle: [task.job ? `${task.job.jobNumber} — ${task.job.title}` : '', task.status, task.priority].filter(Boolean).join(' · '),
      url: `/dashboard/tasks/${task.id}`,
      score: computeScore(q, [task.title], [task.description, task.job?.jobNumber, task.job?.title], task.updatedAt),
      updatedAt: task.updatedAt,
    })),
    limitPerGroup
  )
  if (taskResults.length > 0) {
    groups.push({ type: 'task', label: 'Tasks', results: taskResults })
  }

  // --- Files ----------------------------------------------------------------
  const fileResults = topN(
    (attachmentRows as any[]).map((att) => {
      let subtitle = 'File'
      let url = '#'
      if (att.client) {
        subtitle = `Client: ${att.client.name}`
        url = `/dashboard/clients/${att.client.id}`
      } else if (att.invoice) {
        subtitle = `Invoice ${att.invoice.invoiceNumber}`
        url = `/dashboard/invoices/${att.invoice.id}`
      } else if (att.estimate) {
        subtitle = `Estimate ${att.estimate.estimateNumber}`
        url = `/dashboard/estimates/${att.estimate.id}`
      } else if (att.job) {
        subtitle = `Project ${att.job.jobNumber}`
        url = `/dashboard/jobs/${att.job.id}`
      } else if (att.purchaseOrder) {
        subtitle = `PO ${att.purchaseOrder.poNumber}`
        url = `/dashboard/purchase-orders/${att.purchaseOrder.id}`
      } else if (att.vendor) {
        subtitle = `Vendor ${att.vendor.name}`
        url = `/dashboard/vendors/${att.vendor.id}`
      } else if (att.task) {
        subtitle = `Task: ${att.task.title}`
        url = `/dashboard/tasks/${att.task.id}`
      } else if (att.issue) {
        subtitle = `Issue: ${att.issue.title}`
        url = `/dashboard/issues/${att.issue.id}`
      } else if (att.lead) {
        subtitle = `Request: ${`${att.lead.firstName} ${att.lead.lastName}`.trim() || att.lead.company || ''}`
        url = `/dashboard/requests/${att.lead.id}`
      }
      return {
        id: att.id,
        entityType: 'file',
        title: att.fileName,
        subtitle,
        url,
        score: computeScore(q, [att.fileName], [], att.createdAt),
        updatedAt: att.createdAt,
      }
    }),
    limitPerGroup
  )
  if (fileResults.length > 0) {
    groups.push({ type: 'file', label: 'Files', results: fileResults })
  }

  // --- Notes ----------------------------------------------------------------
  const noteResults = topN(
    (noteRows as any[]).map((note) => {
      let parentName = ''
      let url = '#'
      if (note.client) {
        parentName = note.client.companyName || note.client.name
        url = `/dashboard/clients/${note.client.id}`
      } else if (note.job) {
        parentName = `${note.job.jobNumber} — ${note.job.title}`
        url = `/dashboard/jobs/${note.job.id}`
      }
      return {
        id: note.id,
        entityType: 'note',
        title:
          note.content.length > 80
            ? note.content.slice(0, 80) + '…'
            : note.content,
        subtitle: parentName || 'Note',
        url,
        score: computeScore(q, [note.content.slice(0, 100)], [], note.updatedAt),
        updatedAt: note.updatedAt,
      }
    }),
    limitPerGroup
  )
  if (noteResults.length > 0) {
    groups.push({ type: 'note', label: 'Notes', results: noteResults })
  }

  const pushGroup = (type: string, label: string, results: SearchGroup['results']) => {
    const top = topN(results, limitPerGroup)
    if (top.length > 0) groups.push({ type, label, results: top })
  }

  // --- Requests -------------------------------------------------------------
  pushGroup(
    'request',
    'Requests',
    (leadRows as any[]).map((l) => {
      const name = `${l.firstName ?? ''} ${l.lastName ?? ''}`.trim()
      return {
        id: l.id,
        entityType: 'request',
        title: name || l.company || 'Request',
        subtitle: [l.company, l.jobSiteAddress, l.phone, String(l.status).replace(/_/g, ' ')].filter(Boolean).join(' · '),
        url: `/dashboard/requests/${l.id}`,
        score: computeScore(q, [name, l.company], [l.email, l.phone, l.jobSiteAddress, l.notes], l.updatedAt),
        updatedAt: l.updatedAt,
      }
    })
  )

  // --- Measuring requests ---------------------------------------------------
  pushGroup(
    'measuring',
    'Measuring Requests',
    (measuringRows as any[]).map((m) => {
      const name = `${m.request?.firstName ?? ''} ${m.request?.lastName ?? ''}`.trim() || m.request?.company || 'Request'
      const who = m.assignedUser ? `${m.assignedUser.firstName} ${m.assignedUser.lastName}`.trim() : ''
      return {
        id: m.id,
        entityType: 'measuring',
        title: `Measuring: ${name}`,
        subtitle: [m.request?.jobSiteAddress, who, String(m.status).replace(/_/g, ' ')].filter(Boolean).join(' · '),
        url: '/dashboard/measuring-requests',
        score: computeScore(q, [name], [m.notes, m.request?.jobSiteAddress], m.createdAt),
        updatedAt: m.createdAt,
      }
    })
  )

  // --- Issues ---------------------------------------------------------------
  pushGroup(
    'issue',
    'Issues',
    (issueRows as any[]).map((i) => ({
      id: i.id,
      entityType: 'issue',
      title: i.title,
      subtitle: [i.job ? `${i.job.jobNumber} — ${i.job.title}` : '', i.status, i.priority].filter(Boolean).join(' · '),
      url: `/dashboard/issues/${i.id}`,
      score: computeScore(q, [i.title], [i.description, i.job?.jobNumber, i.job?.title], i.updatedAt),
      updatedAt: i.updatedAt,
    }))
  )

  // --- Schedules ------------------------------------------------------------
  pushGroup(
    'schedule',
    'Schedules',
    (scheduleRows as any[]).map((s) => {
      const who = s.user ? `${s.user.firstName} ${s.user.lastName}`.trim() : ''
      const when = new Date(s.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      return {
        id: s.id,
        entityType: 'schedule',
        title: s.title,
        subtitle: [when, who, s.job ? s.job.jobNumber : ''].filter(Boolean).join(' · '),
        url: `/dashboard/schedule/${s.id}`,
        score: computeScore(q, [s.title, who], [s.description, s.job?.jobNumber, s.job?.title], s.updatedAt),
        updatedAt: s.updatedAt,
      }
    })
  )

  // --- Credit memos ---------------------------------------------------------
  pushGroup(
    'creditMemo',
    'Credit Memos',
    (creditMemoRows as any[]).map((c) => ({
      id: c.id,
      entityType: 'creditMemo',
      title: `${c.creditMemoNumber} — ${c.title}`,
      subtitle: [c.client?.companyName || c.client?.name, `$${Number(c.total).toFixed(2)}`, c.status].filter(Boolean).join(' · '),
      url: `/dashboard/credit-memos/${c.id}`,
      score: computeScore(q, [c.creditMemoNumber, c.title], [c.notes, c.memo, c.client?.name], c.updatedAt),
      updatedAt: c.updatedAt,
    }))
  )

  // --- Team members ---------------------------------------------------------
  pushGroup(
    'user',
    'Team',
    (userRows as any[]).map((u) => {
      const name = `${u.firstName} ${u.lastName}`.trim()
      return {
        id: u.id,
        entityType: 'user',
        title: name || u.email,
        subtitle: [u.role, u.email, u.phone].filter(Boolean).join(' · '),
        url: '/dashboard/teams',
        score: computeScore(q, [name, u.firstName, u.lastName], [u.email, u.phone], u.updatedAt),
        updatedAt: u.updatedAt,
      }
    })
  )

  // --- Calls ----------------------------------------------------------------
  pushGroup(
    'call',
    'Calls',
    (callRows as any[]).map((c) => ({
      id: c.id,
      entityType: 'call',
      title: `${String(c.direction).toLowerCase() === 'inbound' ? 'Call from' : 'Call to'} ${String(c.direction).toLowerCase() === 'inbound' ? c.fromNumber : c.toNumber}`,
      subtitle: [c.client?.name, new Date(c.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), c.status]
        .filter(Boolean)
        .join(' · '),
      url: c.client?.id ? `/dashboard/clients/${c.client.id}` : '/dashboard/calls',
      score: computeScore(q, [c.fromNumber, c.toNumber], [c.client?.name], c.startedAt),
      updatedAt: c.startedAt,
    }))
  )

  return groups
}
