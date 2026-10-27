import { prisma } from '@/lib/prisma'
import { applySmartSearch, buildSmartSearchAnd, clientIdentityClauses, ilike } from '@/lib/search/prisma-filters'
import { jobRecordJobSiteAddressSearchClauses } from '@/lib/search/job-site-address'
import { jobTypeScopeWhereForJobs } from '@/lib/jobs/job-type-scope'
import { andScope, isAssignedOnly, jobScopeWhere } from '@/lib/assignments/scope'
import { ARCHIVE_JOB_STATUSES } from '@/lib/production/production-status'
import { getProductionConfigForTenant } from '@/lib/production/settings'
import { resolveProductionInfo } from '@/lib/production/config'
import type { JobStatusValue } from '@/lib/jobs/statuses'
import {
  allowedManualChanges,
  buildDefaultPipelineConfig,
  daysSince,
  deriveEstimateStage,
  deriveInvoiceStage,
  isFollowUpOverdue,
  mergePipelineConfig,
  stageConfigFor,
  type PipelineConfig,
  type PipelineRecordType,
} from '@/lib/production/pipelines'

export type PipelineItemType = 'JOB' | 'ESTIMATE' | 'INVOICE'

/** One card / row on the Estimates, Invoices or All Work views. */
export interface PipelineItem {
  type: PipelineItemType
  id: string
  number: string
  title: string
  /** The record's real status (never changed by the pipeline). */
  status: string
  stage: string
  stageLabel: string
  stageColor: string
  enteredAt: string | null
  daysInStage: number | null
  closed: boolean
  client: { id: string; name: string } | null
  jobSiteAddress: string | null
  amount: number
  paidAmount: number | null
  balance: number | null
  date: string | null // estimate created / invoice date / job created
  dueDate: string | null
  responsible: { id: string; name: string; isDefault: boolean } | null
  nextAction: string | null
  nextActionIsDefault: boolean
  followUpDate: string | null
  followUpOverdue: boolean
  hold: { onHold: boolean; reason: string | null; heldAt: string | null; releasedAt: string | null }
  notes: string | null
  reviewStage: string | null
  disputed: boolean
  /** A stored review step / dispute the real status has overtaken. */
  ignoredManual: string | null
  allowed: { hold: boolean; review: boolean; dispute: boolean; edit: boolean }
  related: {
    job: { id: string; jobNumber: string; title: string } | null
    estimate: { id: string; estimateNumber: string } | null
    invoices: Array<{ id: string; invoiceNumber: string; status: string }>
    estimates: Array<{ id: string; estimateNumber: string; status: string }>
  }
  href: string
  updatedAt: string
}

export interface PipelineQuery {
  search?: string
  /** Closed records (paid, converted, …) older than this many days are left off. */
  closedDays?: number
  /** Date range on the record date (estimate created / invoice date / job created). */
  from?: Date | null
  to?: Date | null
}

type ScopeUser = { id: string; tenantId: string; role: string }

const DEFAULT_CLOSED_DAYS = 90

export async function getPipelineConfigForTenant(tenantId: string): Promise<PipelineConfig> {
  try {
    const row = await prisma.pipelineSettings.findUnique({ where: { tenantId } })
    return mergePipelineConfig(row?.config ?? null)
  } catch (err) {
    console.error('getPipelineConfigForTenant failed, using defaults:', err)
    return buildDefaultPipelineConfig()
  }
}

export async function savePipelineConfigForTenant(tenantId: string, config: unknown): Promise<PipelineConfig> {
  const clean = mergePipelineConfig(config)
  await prisma.pipelineSettings.upsert({
    where: { tenantId },
    create: { tenantId, config: clean as any },
    update: { config: clean as any },
  })
  return clean
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const fullName = (u?: { firstName?: string | null; lastName?: string | null } | null) =>
  u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown' : ''
const clientOf = (c?: { id: string; name: string; companyName?: string | null } | null) =>
  c ? { id: c.id, name: c.companyName || c.name } : null
const addressText = (a?: { street?: string | null; city?: string | null; state?: string | null; zipCode?: string | null } | null) =>
  a ? [a.street, [a.city, a.state].filter(Boolean).join(', '), a.zipCode].filter(Boolean).join(' ').trim() || null : null

function dateWindow(q: PipelineQuery, field: string) {
  if (!q.from && !q.to) return null
  const range: any = {}
  if (q.from) range.gte = q.from
  if (q.to) range.lte = q.to
  return { [field]: range }
}

/** The person to show when nobody was picked: the job's site manager, else the record's creator. */
function siteManagerOf(job?: { assignments?: Array<{ role: string | null; user: { id: string; firstName: string; lastName: string } }> } | null) {
  const list = job?.assignments || []
  const sm = list.find((a) => a.role === 'SITE_MANAGER') || null
  return sm ? { id: sm.user.id, name: fullName(sm.user) } : null
}

const jobAssignmentSelect = {
  where: { role: 'SITE_MANAGER' },
  take: 1,
  select: { role: true, user: { select: { id: true, firstName: true, lastName: true } } },
} as const

async function loadStates(tenantId: string, recordType: PipelineRecordType, ids: string[]) {
  if (ids.length === 0) return new Map<string, any>()
  const rows = await prisma.pipelineRecordState.findMany({ where: { tenantId, recordType, recordId: { in: ids } } })
  return new Map(rows.map((r) => [r.recordId, r]))
}

async function loadUsers(tenantId: string, ids: Array<string | null | undefined>) {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)))
  if (unique.length === 0) return new Map<string, string>()
  const users = await prisma.user.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, firstName: true, lastName: true },
  })
  return new Map(users.map((u) => [u.id, fullName(u)]))
}

function stateFields(state: any, users: Map<string, string>, fallback: { id: string; name: string } | null) {
  const responsibleId: string | null = state?.responsibleUserId || null
  const responsible = responsibleId
    ? { id: responsibleId, name: users.get(responsibleId) || 'Unknown', isDefault: false }
    : fallback
      ? { ...fallback, isDefault: true }
      : null
  return {
    responsible,
    followUpDate: iso(state?.followUpDate),
    hold: {
      onHold: !!state?.onHold,
      reason: state?.holdReason || null,
      heldAt: iso(state?.heldAt),
      releasedAt: iso(state?.releasedAt),
    },
    notes: state?.notes || null,
    reviewStage: state?.reviewStage || null,
    disputed: !!state?.disputed,
  }
}

export async function loadEstimatePipeline(
  user: ScopeUser,
  q: PipelineQuery,
  config: PipelineConfig,
  canEdit: boolean
): Promise<PipelineItem[]> {
  const closedSince = new Date(Date.now() - (q.closedDays ?? DEFAULT_CLOSED_DAYS) * 86_400_000)
  const where: any = { tenantId: user.tenantId }
  applySmartSearch(
    where,
    buildSmartSearchAnd(q.search || '', (term) => [
      { estimateNumber: ilike(term) },
      { title: ilike(term) },
      ...clientIdentityClauses(term),
      { job: { jobNumber: ilike(term) } },
      { jobSiteAddress: ilike(term) },
    ])
  )
  const range = dateWindow(q, 'createdAt')
  if (range) andScope(where, range)
  // Open estimates always; finished ones only while recent (or inside the chosen range).
  else andScope(where, { OR: [{ status: { in: ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED'] } }, { updatedAt: { gte: closedSince } }] })

  const estimates = await prisma.estimate.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 1000,
    select: {
      id: true,
      estimateNumber: true,
      title: true,
      status: true,
      total: true,
      jobSiteAddress: true,
      createdAt: true,
      updatedAt: true,
      sentAt: true,
      viewedAt: true,
      acceptedAt: true,
      validUntil: true,
      createdById: true,
      client: { select: { id: true, name: true, companyName: true } },
      job: {
        select: {
          id: true,
          jobNumber: true,
          title: true,
          addresses: { where: { type: 'job_site' }, take: 1, select: { street: true, city: true, state: true, zipCode: true } },
          assignments: jobAssignmentSelect,
        },
      },
      invoices: { select: { id: true, invoiceNumber: true, status: true }, orderBy: { createdAt: 'asc' } },
    },
  })

  const states = await loadStates(user.tenantId, 'ESTIMATE', estimates.map((e) => e.id))
  const users = await loadUsers(user.tenantId, [
    ...estimates.map((e) => e.createdById),
    ...Array.from(states.values()).map((s) => s.responsibleUserId),
  ])
  const now = new Date()

  return estimates.map((e) => {
    const state = states.get(e.id)
    const d = deriveEstimateStage(e, state)
    const stageCfg = stageConfigFor(config, 'estimates', d.stage)
    const creator = e.createdById && users.get(e.createdById) ? { id: e.createdById, name: users.get(e.createdById)! } : null
    const fields = stateFields(state, users, siteManagerOf(e.job as any) || creator)
    const allowed = allowedManualChanges('ESTIMATE', e.status, d.closed)
    return {
      type: 'ESTIMATE' as const,
      id: e.id,
      number: e.estimateNumber,
      title: e.title,
      status: e.status,
      stage: d.stage,
      stageLabel: stageCfg?.label || d.stage,
      stageColor: stageCfg?.color || '#94a3b8',
      enteredAt: iso(d.enteredAt),
      daysInStage: daysSince(d.enteredAt, now),
      closed: d.closed,
      client: clientOf(e.client),
      jobSiteAddress: e.jobSiteAddress || addressText(e.job?.addresses?.[0]) || null,
      amount: num(e.total),
      paidAmount: null,
      balance: null,
      date: iso(e.createdAt),
      dueDate: iso(e.validUntil),
      ...fields,
      nextAction: state?.nextAction || stageCfg?.defaultNextAction || null,
      nextActionIsDefault: !state?.nextAction,
      followUpOverdue: isFollowUpOverdue(state?.followUpDate, d.closed, now),
      ignoredManual: d.ignoredManual,
      allowed: { ...allowed, edit: canEdit },
      related: {
        job: e.job ? { id: e.job.id, jobNumber: e.job.jobNumber, title: e.job.title } : null,
        estimate: null,
        invoices: e.invoices,
        estimates: [],
      },
      href: `/dashboard/estimates/${e.id}`,
      updatedAt: e.updatedAt.toISOString(),
    }
  })
}

export async function loadInvoicePipeline(
  user: ScopeUser,
  q: PipelineQuery,
  config: PipelineConfig,
  canEdit: boolean
): Promise<PipelineItem[]> {
  const closedSince = new Date(Date.now() - (q.closedDays ?? DEFAULT_CLOSED_DAYS) * 86_400_000)
  const where: any = { tenantId: user.tenantId }
  applySmartSearch(
    where,
    buildSmartSearchAnd(q.search || '', (term) => [
      { invoiceNumber: ilike(term) },
      { title: ilike(term) },
      ...clientIdentityClauses(term),
      { job: { jobNumber: ilike(term) } },
      { estimate: { jobSiteAddress: ilike(term) } },
    ])
  )
  const range = dateWindow(q, 'invoiceDate')
  if (range) andScope(where, range)
  else
    andScope(where, {
      OR: [
        { status: { in: ['DRAFT', 'SENT', 'VIEWED', 'PARTIAL', 'OVERDUE'] } },
        { updatedAt: { gte: closedSince } },
      ],
    })

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 1000,
    select: {
      id: true,
      invoiceNumber: true,
      title: true,
      status: true,
      total: true,
      paidAmount: true,
      balance: true,
      invoiceDate: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
      sentAt: true,
      viewedAt: true,
      paidAt: true,
      client: {
        select: {
          id: true,
          name: true,
          companyName: true,
          addresses: { where: { type: 'job_site' }, take: 1, select: { street: true, city: true, state: true, zipCode: true } },
        },
      },
      job: {
        select: {
          id: true,
          jobNumber: true,
          title: true,
          addresses: { where: { type: 'job_site' }, take: 1, select: { street: true, city: true, state: true, zipCode: true } },
          assignments: jobAssignmentSelect,
        },
      },
      estimate: { select: { id: true, estimateNumber: true, jobSiteAddress: true, createdById: true } },
      payments: {
        where: { status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  })

  const states = await loadStates(user.tenantId, 'INVOICE', invoices.map((i) => i.id))
  const users = await loadUsers(user.tenantId, [
    ...invoices.map((i) => i.estimate?.createdById),
    ...Array.from(states.values()).map((s) => s.responsibleUserId),
  ])
  const now = new Date()

  return invoices.map((inv) => {
    const state = states.get(inv.id)
    const d = deriveInvoiceStage({ ...inv, lastPaymentAt: inv.payments[0]?.createdAt || null }, state, now)
    const stageCfg = stageConfigFor(config, 'invoices', d.stage)
    const estCreator = inv.estimate?.createdById && users.get(inv.estimate.createdById)
      ? { id: inv.estimate.createdById, name: users.get(inv.estimate.createdById)! }
      : null
    const fields = stateFields(state, users, siteManagerOf(inv.job as any) || estCreator)
    const allowed = allowedManualChanges('INVOICE', inv.status, d.closed)
    return {
      type: 'INVOICE' as const,
      id: inv.id,
      number: inv.invoiceNumber,
      title: inv.title,
      status: inv.status,
      stage: d.stage,
      stageLabel: stageCfg?.label || d.stage,
      stageColor: stageCfg?.color || '#94a3b8',
      enteredAt: iso(d.enteredAt),
      daysInStage: daysSince(d.enteredAt, now),
      closed: d.closed,
      client: clientOf(inv.client),
      jobSiteAddress:
        inv.estimate?.jobSiteAddress || addressText(inv.job?.addresses?.[0]) || addressText(inv.client?.addresses?.[0]) || null,
      amount: num(inv.total),
      paidAmount: num(inv.paidAmount),
      balance: num(inv.balance),
      date: iso(inv.invoiceDate),
      dueDate: iso(inv.dueDate),
      ...fields,
      nextAction: state?.nextAction || stageCfg?.defaultNextAction || null,
      nextActionIsDefault: !state?.nextAction,
      followUpOverdue: isFollowUpOverdue(state?.followUpDate, d.closed, now),
      ignoredManual: d.ignoredManual,
      allowed: { ...allowed, edit: canEdit },
      related: {
        job: inv.job ? { id: inv.job.id, jobNumber: inv.job.jobNumber, title: inv.job.title } : null,
        estimate: inv.estimate ? { id: inv.estimate.id, estimateNumber: inv.estimate.estimateNumber } : null,
        invoices: [],
        estimates: [],
      },
      href: `/dashboard/invoices/${inv.id}`,
      updatedAt: inv.updatedAt.toISOString(),
    }
  })
}

/**
 * Active jobs for the All Work overview, with exactly the same access rules and
 * stage names as the Jobs production line (read only — nothing about jobs changes here).
 */
export async function loadJobsForAllWork(user: ScopeUser, q: PipelineQuery): Promise<PipelineItem[]> {
  const where: any = {
    tenantId: user.tenantId,
    ...(await jobTypeScopeWhereForJobs(user.id, user.tenantId)),
    status: { notIn: ARCHIVE_JOB_STATUSES },
  }
  applySmartSearch(
    where,
    buildSmartSearchAnd(q.search || '', (term) => [
      { jobNumber: ilike(term) },
      { title: ilike(term) },
      ...clientIdentityClauses(term),
      ...jobRecordJobSiteAddressSearchClauses(term),
    ])
  )
  if (await isAssignedOnly(user, 'jobs')) andScope(where, jobScopeWhere(user.id))
  const range = dateWindow(q, 'createdAt')
  if (range) andScope(where, range)

  const [jobs, jobConfig] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        jobNumber: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        scheduledEnd: true,
        client: { select: { id: true, name: true, companyName: true } },
        addresses: { where: { type: 'job_site' }, take: 1, select: { street: true, city: true, state: true, zipCode: true } },
        assignments: { select: { role: true, user: { select: { id: true, firstName: true, lastName: true } } } },
        estimates: { select: { id: true, estimateNumber: true, status: true } },
        invoices: { select: { id: true, invoiceNumber: true, status: true } },
      },
    }),
    getProductionConfigForTenant(user.tenantId),
  ])
  const now = new Date()

  return jobs.map((j) => {
    const info = resolveProductionInfo(j.status as JobStatusValue, jobConfig)
    const stageCfg = jobConfig.stages.find((s) => s.status === j.status)
    const sm = siteManagerOf(j as any)
    const firstAssignee = j.assignments[0]?.user
    const responsible = sm || (firstAssignee ? { id: firstAssignee.id, name: fullName(firstAssignee) } : null)
    return {
      type: 'JOB' as const,
      id: j.id,
      number: j.jobNumber,
      title: j.title,
      status: j.status,
      stage: j.status,
      stageLabel: info.boardLabel,
      stageColor: stageCfg?.color || '#94a3b8',
      // Jobs don't record when their status changed; last update is the closest date we have.
      enteredAt: iso(j.updatedAt),
      daysInStage: daysSince(j.updatedAt, now),
      closed: false,
      client: clientOf(j.client),
      jobSiteAddress: addressText(j.addresses?.[0]),
      amount: 0,
      paidAmount: null,
      balance: null,
      date: iso(j.createdAt),
      dueDate: iso(j.scheduledEnd),
      responsible: responsible ? { ...responsible, isDefault: true } : null,
      nextAction: info.nextAction || null,
      nextActionIsDefault: true,
      followUpDate: null,
      followUpOverdue: !!j.scheduledEnd && j.scheduledEnd < new Date(now.toDateString()),
      hold: { onHold: j.status === 'ON_HOLD', reason: null, heldAt: null, releasedAt: null },
      notes: null,
      reviewStage: null,
      disputed: false,
      ignoredManual: null,
      allowed: { hold: false, review: false, dispute: false, edit: false },
      related: { job: null, estimate: null, invoices: j.invoices, estimates: j.estimates },
      href: `/dashboard/jobs/${j.id}`,
      updatedAt: j.updatedAt.toISOString(),
    }
  })
}
