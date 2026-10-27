// Estimate and Invoice pipelines for the Production area.
//
// A pipeline stage is a DERIVED view of the record's real status (and, for
// invoices, its accounting numbers). Nothing here changes an estimate's
// approval status or an invoice's payment status. The only extra, stored
// information lives in PipelineRecordState: hold, responsible person, next
// action, follow-up date, notes, and an optional review step while the record
// is still a draft (Internal Review / Ready to Send). The invoice "Disputed"
// flag is also stored there, and it never outranks Paid / Cancelled / Refunded.
//
// Pure functions only — no Prisma — so the rules are easy to test.

export type PipelineRecordType = 'ESTIMATE' | 'INVOICE'
export type PipelineBoardKey = 'estimates' | 'invoices'

export const ESTIMATE_STAGE_IDS = [
  'DRAFT',
  'INTERNAL_REVIEW',
  'READY_TO_SEND',
  'SENT',
  'AWAITING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CONVERTED',
  'ON_HOLD',
] as const
export type EstimateStageId = (typeof ESTIMATE_STAGE_IDS)[number]

export const INVOICE_STAGE_IDS = [
  'DRAFT',
  'INTERNAL_REVIEW',
  'READY_TO_SEND',
  'SENT',
  'PAYMENT_OUTSTANDING',
  'PARTIALLY_PAID',
  'OVERDUE',
  'DISPUTED',
  'PAID',
  'CANCELLED',
  'REFUNDED',
  'ON_HOLD',
] as const
export type InvoiceStageId = (typeof INVOICE_STAGE_IDS)[number]

export type PipelineStageId = EstimateStageId | InvoiceStageId

/** Review steps a person may pick while the record is still a DRAFT. */
export const DRAFT_REVIEW_STAGES = ['INTERNAL_REVIEW', 'READY_TO_SEND'] as const
export type DraftReviewStage = (typeof DRAFT_REVIEW_STAGES)[number]

export interface PipelineStageConfig {
  id: string
  label: string
  color: string
  icon: string
  order: number
  visible: boolean
  defaultNextAction: string
}

export interface PipelineConfig {
  estimates: { stages: PipelineStageConfig[] }
  invoices: { stages: PipelineStageConfig[] }
  /** Choices offered when putting something on hold ("Other" is always allowed). */
  holdReasons: string[]
  /** Follow-up date suggested when placing a record on hold (days from today). */
  holdFollowUpDays: number
  /** Which record types the All Work overview shows. */
  allWork: { jobs: boolean; estimates: boolean; invoices: boolean }
}

// Stages that end the record's workflow. Holds don't apply to these, and the
// boards only show recent ones unless a date range is chosen.
export const CLOSED_ESTIMATE_STAGES: EstimateStageId[] = ['REJECTED', 'EXPIRED', 'CONVERTED']
export const CLOSED_INVOICE_STAGES: InvoiceStageId[] = ['PAID', 'CANCELLED', 'REFUNDED']

const ESTIMATE_DEFAULTS: Array<Omit<PipelineStageConfig, 'order' | 'visible'>> = [
  { id: 'DRAFT', label: 'Draft', color: '#94a3b8', icon: 'Circle', defaultNextAction: 'Finish the estimate' },
  { id: 'INTERNAL_REVIEW', label: 'Internal Review', color: '#6366f1', icon: 'CircleDot', defaultNextAction: 'Review scope and pricing' },
  { id: 'READY_TO_SEND', label: 'Ready to Send', color: '#0ea5e9', icon: 'Flag', defaultNextAction: 'Send to the client' },
  { id: 'SENT', label: 'Sent to Client', color: '#3b82f6', icon: 'Truck', defaultNextAction: 'Follow up with the client' },
  { id: 'AWAITING_APPROVAL', label: 'Awaiting Approval', color: '#a855f7', icon: 'Clock', defaultNextAction: "Get the client's decision" },
  { id: 'APPROVED', label: 'Approved', color: '#22c55e', icon: 'CheckCircle', defaultNextAction: 'Schedule the work or invoice the deposit' },
  { id: 'REJECTED', label: 'Rejected', color: '#ef4444', icon: 'AlertCircle', defaultNextAction: 'Revise or close out' },
  { id: 'EXPIRED', label: 'Expired', color: '#9ca3af', icon: 'Clock', defaultNextAction: 'Revise and resend' },
  { id: 'CONVERTED', label: 'Converted to Invoice', color: '#16a34a', icon: 'CheckCircle', defaultNextAction: 'Nothing — invoiced' },
  { id: 'ON_HOLD', label: 'On Hold', color: '#f97316', icon: 'PauseCircle', defaultNextAction: 'Resolve the hold' },
]

const INVOICE_DEFAULTS: Array<Omit<PipelineStageConfig, 'order' | 'visible'>> = [
  { id: 'DRAFT', label: 'Draft', color: '#94a3b8', icon: 'Circle', defaultNextAction: 'Finish the invoice' },
  { id: 'INTERNAL_REVIEW', label: 'Internal Review', color: '#6366f1', icon: 'CircleDot', defaultNextAction: 'Review the invoice' },
  { id: 'READY_TO_SEND', label: 'Ready to Send', color: '#0ea5e9', icon: 'Flag', defaultNextAction: 'Send to the client' },
  { id: 'SENT', label: 'Sent', color: '#3b82f6', icon: 'Truck', defaultNextAction: 'Wait for payment' },
  { id: 'PAYMENT_OUTSTANDING', label: 'Payment Outstanding', color: '#8b5cf6', icon: 'Clock', defaultNextAction: 'Follow up on payment' },
  { id: 'PARTIALLY_PAID', label: 'Partially Paid', color: '#eab308', icon: 'PlayCircle', defaultNextAction: 'Collect the balance' },
  { id: 'OVERDUE', label: 'Overdue', color: '#dc2626', icon: 'AlertCircle', defaultNextAction: 'Call about the overdue balance' },
  { id: 'DISPUTED', label: 'Disputed', color: '#d946ef', icon: 'AlertCircle', defaultNextAction: 'Resolve the dispute' },
  { id: 'PAID', label: 'Paid', color: '#22c55e', icon: 'CheckCircle', defaultNextAction: 'Nothing — paid' },
  { id: 'CANCELLED', label: 'Cancelled', color: '#6b7280', icon: 'AlertCircle', defaultNextAction: 'Nothing — cancelled' },
  { id: 'REFUNDED', label: 'Refunded', color: '#64748b', icon: 'Package', defaultNextAction: 'Nothing — refunded' },
  { id: 'ON_HOLD', label: 'On Hold', color: '#f97316', icon: 'PauseCircle', defaultNextAction: 'Resolve the hold' },
]

export const DEFAULT_HOLD_REASONS = [
  'Waiting on client',
  'Waiting on materials',
  'Pricing question',
  'Scope change',
  'Payment issue',
  'Internal approval needed',
]

function withOrder(list: Array<Omit<PipelineStageConfig, 'order' | 'visible'>>): PipelineStageConfig[] {
  return list.map((s, i) => ({ ...s, order: i, visible: true }))
}

export function buildDefaultPipelineConfig(): PipelineConfig {
  return {
    estimates: { stages: withOrder(ESTIMATE_DEFAULTS) },
    invoices: { stages: withOrder(INVOICE_DEFAULTS) },
    holdReasons: [...DEFAULT_HOLD_REASONS],
    holdFollowUpDays: 3,
    allWork: { jobs: true, estimates: true, invoices: true },
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/

function mergeStages(base: PipelineStageConfig[], stored: any): PipelineStageConfig[] {
  // Stage ids are fixed (they map to real statuses); only display settings are configurable.
  const byId = new Map<string, any>()
  if (Array.isArray(stored)) for (const s of stored) if (s && typeof s.id === 'string') byId.set(s.id, s)
  return base
    .map((b) => {
      const s = byId.get(b.id)
      if (!s) return b
      return {
        ...b,
        label: typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 40) : b.label,
        color: typeof s.color === 'string' && HEX.test(s.color) ? s.color : b.color,
        order: Number.isFinite(Number(s.order)) ? Number(s.order) : b.order,
        visible: typeof s.visible === 'boolean' ? s.visible : b.visible,
        defaultNextAction:
          typeof s.defaultNextAction === 'string' ? s.defaultNextAction.trim().slice(0, 120) : b.defaultNextAction,
      }
    })
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: i }))
}

/** Stored (possibly partial / older) settings over the defaults; always complete and valid. */
export function mergePipelineConfig(stored: any): PipelineConfig {
  const base = buildDefaultPipelineConfig()
  if (!stored || typeof stored !== 'object') return base
  const reasons = Array.isArray(stored.holdReasons)
    ? stored.holdReasons.map((r: any) => String(r || '').trim().slice(0, 60)).filter(Boolean).slice(0, 20)
    : base.holdReasons
  const days = Number(stored.holdFollowUpDays)
  return {
    estimates: { stages: mergeStages(base.estimates.stages, stored.estimates?.stages) },
    invoices: { stages: mergeStages(base.invoices.stages, stored.invoices?.stages) },
    holdReasons: reasons.length ? reasons : base.holdReasons,
    holdFollowUpDays: Number.isFinite(days) && days >= 0 && days <= 90 ? Math.round(days) : base.holdFollowUpDays,
    allWork: {
      jobs: stored.allWork?.jobs !== false,
      estimates: stored.allWork?.estimates !== false,
      invoices: stored.allWork?.invoices !== false,
    },
  }
}

// ---- stage derivation ----------------------------------------------------------

export interface PipelineStateInput {
  onHold?: boolean | null
  heldAt?: Date | string | null
  reviewStage?: string | null
  reviewStageAt?: Date | string | null
  disputed?: boolean | null
  disputedAt?: Date | string | null
}

export interface EstimateStageInput {
  status: string
  createdAt: Date | string
  updatedAt?: Date | string | null
  sentAt?: Date | string | null
  viewedAt?: Date | string | null
  acceptedAt?: Date | string | null
}

// number, numeric string, or a Prisma Decimal
type Numeric = number | string | { toString(): string }

export interface InvoiceStageInput {
  status: string
  total: Numeric
  paidAmount: Numeric
  balance: Numeric
  dueDate?: Date | string | null
  invoiceDate?: Date | string | null
  createdAt: Date | string
  updatedAt?: Date | string | null
  sentAt?: Date | string | null
  viewedAt?: Date | string | null
  paidAt?: Date | string | null
  /** Most recent completed payment, used as "entered Partially Paid". */
  lastPaymentAt?: Date | string | null
}

export interface DerivedStage<T extends string = string> {
  stage: T
  /** When the record entered this stage, from the record's own dates where possible. */
  enteredAt: Date | null
  closed: boolean
  /** A stored review step / dispute that no longer applies (e.g. the draft was sent). */
  ignoredManual: string | null
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function isDraftReview(v: string | null | undefined): v is DraftReviewStage {
  return v === 'INTERNAL_REVIEW' || v === 'READY_TO_SEND'
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function deriveEstimateStage(est: EstimateStageInput, state?: PipelineStateInput | null): DerivedStage<EstimateStageId> {
  const status = String(est.status || '').toUpperCase()
  const updated = toDate(est.updatedAt) || toDate(est.createdAt)
  const review = state?.reviewStage || null
  const ignored = review && !(status === 'DRAFT' && isDraftReview(review)) ? review : null

  // The real status always decides closed outcomes; a hold can't hide them.
  if (status === 'REJECTED') return { stage: 'REJECTED', enteredAt: updated, closed: true, ignoredManual: ignored }
  if (status === 'EXPIRED') return { stage: 'EXPIRED', enteredAt: updated, closed: true, ignoredManual: ignored }
  if (status === 'CONVERTED') return { stage: 'CONVERTED', enteredAt: updated, closed: true, ignoredManual: ignored }

  if (state?.onHold) return { stage: 'ON_HOLD', enteredAt: toDate(state.heldAt) || updated, closed: false, ignoredManual: ignored }

  if (status === 'DRAFT') {
    if (isDraftReview(review)) {
      return { stage: review, enteredAt: toDate(state?.reviewStageAt) || updated, closed: false, ignoredManual: null }
    }
    return { stage: 'DRAFT', enteredAt: toDate(est.createdAt), closed: false, ignoredManual: ignored }
  }
  if (status === 'SENT') return { stage: 'SENT', enteredAt: toDate(est.sentAt) || updated, closed: false, ignoredManual: ignored }
  if (status === 'VIEWED') {
    return { stage: 'AWAITING_APPROVAL', enteredAt: toDate(est.viewedAt) || toDate(est.sentAt) || updated, closed: false, ignoredManual: ignored }
  }
  if (status === 'ACCEPTED') return { stage: 'APPROVED', enteredAt: toDate(est.acceptedAt) || updated, closed: false, ignoredManual: ignored }
  // Unknown status: show it as a draft rather than inventing a stage.
  return { stage: 'DRAFT', enteredAt: updated, closed: false, ignoredManual: ignored }
}

export function isInvoiceOverdue(inv: Pick<InvoiceStageInput, 'status' | 'balance' | 'dueDate'>, now: Date = new Date()): boolean {
  const status = String(inv.status || '').toUpperCase()
  const balance = Number(inv.balance) || 0
  if (balance <= 0.004) return false
  if (status === 'OVERDUE') return true
  if (!['SENT', 'VIEWED', 'PARTIAL'].includes(status)) return false
  const due = toDate(inv.dueDate)
  return !!due && startOfDay(due) < startOfDay(now)
}

export function deriveInvoiceStage(
  inv: InvoiceStageInput,
  state?: PipelineStateInput | null,
  now: Date = new Date()
): DerivedStage<InvoiceStageId> {
  const status = String(inv.status || '').toUpperCase()
  const total = Number(inv.total) || 0
  const paid = Number(inv.paidAmount) || 0
  const balance = Number(inv.balance) || 0
  const updated = toDate(inv.updatedAt) || toDate(inv.createdAt)
  const review = state?.reviewStage || null
  let ignored: string | null = review && !(status === 'DRAFT' && isDraftReview(review)) ? review : null

  // Accounting is authoritative: these win over every stored flag.
  if (status === 'CANCELLED') return { stage: 'CANCELLED', enteredAt: updated, closed: true, ignoredManual: ignored || (state?.disputed ? 'DISPUTED' : null) }
  if (status === 'REFUNDED') return { stage: 'REFUNDED', enteredAt: updated, closed: true, ignoredManual: ignored || (state?.disputed ? 'DISPUTED' : null) }
  const fullyPaid = status === 'PAID' || (status !== 'DRAFT' && total > 0 && balance <= 0.004)
  if (fullyPaid) {
    return { stage: 'PAID', enteredAt: toDate(inv.paidAt) || toDate(inv.lastPaymentAt) || updated, closed: true, ignoredManual: ignored || (state?.disputed ? 'DISPUTED' : null) }
  }

  if (state?.onHold) return { stage: 'ON_HOLD', enteredAt: toDate(state.heldAt) || updated, closed: false, ignoredManual: ignored }

  if (status === 'DRAFT') {
    if (state?.disputed) ignored = ignored || 'DISPUTED'
    if (isDraftReview(review)) {
      return { stage: review, enteredAt: toDate(state?.reviewStageAt) || updated, closed: false, ignoredManual: state?.disputed ? 'DISPUTED' : null }
    }
    return { stage: 'DRAFT', enteredAt: toDate(inv.createdAt), closed: false, ignoredManual: ignored }
  }

  if (state?.disputed) return { stage: 'DISPUTED', enteredAt: toDate(state.disputedAt) || updated, closed: false, ignoredManual: ignored }

  if (isInvoiceOverdue(inv, now)) {
    const due = toDate(inv.dueDate)
    const dayAfterDue = due ? new Date(startOfDay(due).getTime() + 86_400_000) : null
    return { stage: 'OVERDUE', enteredAt: dayAfterDue || updated, closed: false, ignoredManual: ignored }
  }
  if (paid > 0.004 || status === 'PARTIAL') {
    return { stage: 'PARTIALLY_PAID', enteredAt: toDate(inv.lastPaymentAt) || updated, closed: false, ignoredManual: ignored }
  }
  if (status === 'VIEWED') {
    return { stage: 'PAYMENT_OUTSTANDING', enteredAt: toDate(inv.viewedAt) || toDate(inv.sentAt) || updated, closed: false, ignoredManual: ignored }
  }
  return { stage: 'SENT', enteredAt: toDate(inv.sentAt) || toDate(inv.invoiceDate) || updated, closed: false, ignoredManual: ignored }
}

/** Which stored flags a person may set right now (so the UI can't contradict the real status). */
export function allowedManualChanges(
  type: PipelineRecordType,
  status: string,
  closed: boolean
): { hold: boolean; review: boolean; dispute: boolean } {
  const s = String(status || '').toUpperCase()
  return {
    hold: !closed,
    review: s === 'DRAFT',
    dispute: type === 'INVOICE' && !closed && s !== 'DRAFT',
  }
}

export function stageConfigFor(config: PipelineConfig, board: PipelineBoardKey, stageId: string): PipelineStageConfig | undefined {
  return config[board].stages.find((s) => s.id === stageId)
}

/** Whole days since a date (0 for today). */
export function daysSince(date: Date | null, now: Date = new Date()): number | null {
  if (!date) return null
  return Math.max(0, Math.floor((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000))
}

export function isFollowUpOverdue(followUpDate: Date | string | null | undefined, closed: boolean, now: Date = new Date()): boolean {
  if (closed) return false
  const d = toDate(followUpDate)
  return !!d && startOfDay(d) < startOfDay(now)
}
