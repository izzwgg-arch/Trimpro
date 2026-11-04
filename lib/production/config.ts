/**
 * Production Settings — per-tenant CUSTOMIZATION of how the Production board
 * displays the existing Job Statuses. This NEVER introduces a second status
 * system: every stage is keyed by an existing JobStatus value, which remains
 * the single source of truth. Changing a display name, color, order, etc.
 * only changes presentation; the board still groups jobs strictly by
 * Job.status. Defaults are derived from PRODUCTION_STATUS_MAP so Production
 * works immediately with zero configuration.
 */
import { JOB_STATUSES, type JobStatusValue } from '@/lib/jobs/statuses'
import { jobStatusHexColors } from '@/lib/jobs/statuses'
import {
  PRODUCTION_STATUS_MAP,
  ARCHIVE_JOB_STATUSES,
} from '@/lib/production/production-status'

export const PRODUCTION_CONFIG_VERSION = 1

/** All existing Job Status values (the source of truth the board groups by). */
const ALL_STATUSES: JobStatusValue[] = JOB_STATUSES.map((s) => s.value as JobStatusValue)

export type ProductionSortKey =
  | 'dueDate'
  | 'priority'
  | 'createdDate'
  | 'jobNumber'
  | 'client'
  | 'jobSiteAddress'
  | 'assignedUser'
  | 'lastUpdated'

export type ProductionSortDir = 'asc' | 'desc'

export type CardDensity = 'compact' | 'standard' | 'detailed'
export type CardBorderStyle = 'none' | 'left-accent' | 'full'

/** One configurable stage = one existing Job Status rendered on the board. */
export interface ProductionStageConfig {
  /** The existing Job Status this stage maps to — the immutable source of truth. */
  status: JobStatusValue
  displayName: string
  description: string
  color: string // hex
  icon: string // lucide icon key (see PRODUCTION_ICONS)
  order: number
  visible: boolean
  showJobCount: boolean
  defaultSort: ProductionSortKey
  defaultSortDir: ProductionSortDir
  /** Production "Next Action" display text for jobs in this status. */
  nextAction: string
}

/**
 * A board column groups one or more existing Job Statuses under a custom
 * heading. Admins can add columns and assign statuses to them. Jobs still
 * belong to their real Job.status; a job renders in whichever column claims
 * its status (each active status belongs to exactly one column).
 */
export interface ProductionColumnConfig {
  id: string
  displayName: string
  color: string
  icon: string
  order: number
  visible: boolean
  showJobCount: boolean
  defaultSort: ProductionSortKey
  defaultSortDir: ProductionSortDir
  /** Existing Job Statuses that feed this column (never archive statuses). */
  statuses: JobStatusValue[]
  /** Blink a card red once it has sat in this column longer than `agingDays`. */
  agingEnabled: boolean
  agingDays: number
}

/** The card fields an admin can show/hide/reorder. Keys are stable. */
export type ProductionCardFieldKey =
  | 'jobNumber'
  | 'jobName'
  | 'client'
  | 'jobSiteAddress'
  | 'jobStatus'
  | 'productionStage'
  | 'nextAction'
  | 'assignedUser'
  | 'dueDate'
  | 'createdDate'
  | 'priority'
  | 'jobType'
  | 'estimateAmount'
  | 'invoiceAmount'
  | 'billingStatus'
  | 'purchaseOrder'
  | 'notes'

export interface ProductionCardFieldConfig {
  key: ProductionCardFieldKey
  visible: boolean
  order: number
}

export interface ProductionCardConfig {
  density: CardDensity
  width: number // px (board column width)
  borderStyle: CardBorderStyle
  showStatusBadge: boolean
  showNextAction: boolean
  emphasizeJobNumber: boolean
  showAddress: boolean
  showAssignedUser: boolean
  showDueDate: boolean
  /** Column-header color follows each stage's color; this is the optional left accent. */
  accentFromStageColor: boolean
  fields: ProductionCardFieldConfig[]
}

export type ProductionFilterKey =
  | 'search'
  | 'assignedTo'
  | 'priority'
  | 'dueDate'
  | 'client'
  | 'jobType'
  | 'jobSiteAddress'
  | 'status'
  | 'overdue'

export interface ProductionAutomationConfig {
  /** These three are inherent (Production is derived from status) and always on. */
  moveToColumn: boolean
  updateStage: boolean
  updateNextAction: boolean
  /** Optional side-effects that reuse existing Task / Notification systems. */
  createTask: boolean
  createTaskTitle?: string
  notifyAssignedUser: boolean
}

/** A tenant-defined Job Status added on top of the built-in ones. */
export interface JobStatusOption {
  value: string
  label: string
  color: string // hex
}

export interface ProductionConfig {
  version: number
  /** Board columns (custom groupings of statuses). */
  columns: ProductionColumnConfig[]
  /** Per-status settings: card "Stage" label + Next Action (+ On Hold/archive display). */
  stages: ProductionStageConfig[]
  /** Tenant-added Job Statuses (beyond the built-in ones). */
  customStatuses: JobStatusOption[]
  /** Built-in statuses the tenant removed (hidden from pickers and the board). */
  hiddenBuiltinStatuses: string[]
  /** Per built-in status: renamed label and/or custom color. */
  builtinStatusOverrides: Record<string, { label?: string; color?: string }>
  card: ProductionCardConfig
  filters: Record<ProductionFilterKey, boolean>
  automation: Record<string, ProductionAutomationConfig>
}

const STATUS_VALUE_RE = /^[A-Z0-9_]+$/

/** Turn a free-text label into a stable status value (e.g. "Awaiting paint" -> "AWAITING_PAINT"). */
export function slugifyStatusValue(input: string): string {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

type BuiltinStatusOverride = { label?: string; color?: string }
type CatalogConfig = {
  customStatuses?: JobStatusOption[]
  builtinStatusOverrides?: Record<string, BuiltinStatusOverride>
  hiddenBuiltinStatuses?: string[]
} | null

/**
 * Built-in statuses plus the tenant's custom ones (value/label/color).
 * Built-ins can be renamed/recolored (via overrides) and removed (hidden),
 * so this applies those overrides and drops hidden built-ins.
 */
export function jobStatusCatalog(config?: CatalogConfig): JobStatusOption[] {
  const hidden = new Set(config?.hiddenBuiltinStatuses || [])
  const overrides = config?.builtinStatusOverrides || {}
  const builtin: JobStatusOption[] = JOB_STATUSES.filter((s) => !hidden.has(s.value)).map((s) => {
    const o = overrides[s.value] || {}
    return {
      value: s.value,
      label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : s.label,
      color: typeof o.color === 'string' ? o.color : jobStatusHexColors[s.value] || '#64748b',
    }
  })
  const seen = new Set<string>(JOB_STATUSES.map((s) => s.value))
  const extra: JobStatusOption[] = []
  for (const c of config?.customStatuses || []) {
    if (!c || typeof c.value !== 'string') continue
    const value = c.value
    if (!STATUS_VALUE_RE.test(value) || extra.some((e) => e.value === value)) continue
    seen.add(value)
    extra.push({ value, label: String(c.label || value), color: typeof c.color === 'string' ? c.color : '#64748b' })
  }
  return [...builtin, ...extra]
}

/** Display label for any status value (built-in or custom). */
export function jobStatusLabelFor(value: string, config?: { customStatuses?: JobStatusOption[] } | null): string {
  return jobStatusCatalog(config).find((s) => s.value === value)?.label || String(value || '').replaceAll('_', ' ')
}

/** Active statuses that can be placed into board columns (not On Hold/archive/removed). Includes custom statuses. */
export function activeColumnStatuses(config?: CatalogConfig): string[] {
  const hidden = new Set(config?.hiddenBuiltinStatuses || [])
  const builtin = ALL_STATUSES.filter((s) => s !== 'ON_HOLD' && !isArchiveStatus(s) && !hidden.has(s))
  const custom = (config?.customStatuses || [])
    .map((c) => c?.value)
    .filter((v): v is string => typeof v === 'string' && STATUS_VALUE_RE.test(v) && !(ALL_STATUSES as string[]).includes(v))
  return [...builtin, ...custom]
}

/** Card-field catalog: key → label + whether it renders by default. */
export const PRODUCTION_CARD_FIELDS: Array<{ key: ProductionCardFieldKey; label: string; defaultVisible: boolean }> = [
  { key: 'jobNumber', label: 'Job Number', defaultVisible: true },
  { key: 'jobName', label: 'Job Name', defaultVisible: true },
  { key: 'client', label: 'Client', defaultVisible: true },
  { key: 'jobSiteAddress', label: 'Job Site Address', defaultVisible: true },
  { key: 'jobStatus', label: 'Job Status', defaultVisible: true },
  { key: 'productionStage', label: 'Production Stage', defaultVisible: true },
  { key: 'nextAction', label: 'Next Action', defaultVisible: true },
  { key: 'assignedUser', label: 'Assigned User / Crew', defaultVisible: true },
  { key: 'dueDate', label: 'Due Date', defaultVisible: true },
  { key: 'createdDate', label: 'Created Date', defaultVisible: false },
  { key: 'priority', label: 'Priority', defaultVisible: true },
  { key: 'jobType', label: 'Job Type', defaultVisible: false },
  { key: 'estimateAmount', label: 'Estimate Amount', defaultVisible: true },
  { key: 'invoiceAmount', label: 'Invoice Amount', defaultVisible: false },
  { key: 'billingStatus', label: 'Billing Status', defaultVisible: false },
  { key: 'purchaseOrder', label: 'Purchase Order', defaultVisible: false },
  { key: 'notes', label: 'Notes', defaultVisible: false },
]

/** lucide-react icon keys offered for stages (kept to a curated, imported set). */
export const PRODUCTION_ICONS = [
  'Circle', 'CircleDot', 'PlayCircle', 'Ruler', 'ShoppingCart', 'Truck',
  'Hammer', 'Wrench', 'CheckCircle', 'PauseCircle', 'Package', 'Clock',
  'AlertCircle', 'Flag', 'Factory', 'Boxes',
] as const

const DEFAULT_STATUS_ICON: Record<string, string> = {
  QUOTE: 'Circle',
  SCHEDULED: 'Flag',
  IN_PROGRESS: 'PlayCircle',
  MEASURED: 'Ruler',
  NEED_TO_ORDER: 'ShoppingCart',
  ORDERED: 'Truck',
  INSTALLATION_COMPLETE: 'Hammer',
  NEED_TOUCH_UPS: 'Wrench',
  FINISHING_COMPLETE: 'CheckCircle',
  ON_HOLD: 'PauseCircle',
  COMPLETED: 'CheckCircle',
  CANCELLED: 'AlertCircle',
  INVOICED: 'Package',
}

export function isArchiveStatus(status: JobStatusValue): boolean {
  return (ARCHIVE_JOB_STATUSES as string[]).includes(status)
}

/** The display order of the active board columns, matching the existing board. */
const DEFAULT_STAGE_ORDER: JobStatusValue[] = [
  'QUOTE', 'SCHEDULED', 'IN_PROGRESS', 'MEASURED', 'NEED_TO_ORDER', 'ORDERED',
  'INSTALLATION_COMPLETE', 'NEED_TOUCH_UPS', 'FINISHING_COMPLETE',
  'ON_HOLD', 'COMPLETED', 'CANCELLED', 'INVOICED',
]

function defaultCard(): ProductionCardConfig {
  return {
    density: 'standard',
    width: 288,
    borderStyle: 'left-accent',
    showStatusBadge: true,
    showNextAction: true,
    emphasizeJobNumber: true,
    showAddress: true,
    showAssignedUser: true,
    showDueDate: true,
    accentFromStageColor: true,
    fields: PRODUCTION_CARD_FIELDS.map((f, i) => ({ key: f.key, visible: f.defaultVisible, order: i })),
  }
}

function defaultAutomation(): ProductionAutomationConfig {
  return {
    moveToColumn: true,
    updateStage: true,
    updateNextAction: true,
    createTask: false,
    createTaskTitle: '',
    notifyAssignedUser: false,
  }
}

/** Default columns: one per active status, seeded from the stage display. */
function buildColumnsFromStages(stages: ProductionStageConfig[], activeStatuses: string[] = activeColumnStatuses()): ProductionColumnConfig[] {
  const active = activeStatuses
  return stages
    .filter((s) => active.includes(s.status))
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({
      id: `col_${s.status}`,
      displayName: s.displayName,
      color: s.color,
      icon: s.icon,
      order: i,
      visible: s.visible,
      showJobCount: s.showJobCount,
      defaultSort: s.defaultSort,
      defaultSortDir: s.defaultSortDir,
      statuses: [s.status],
      agingEnabled: false,
      agingDays: 7,
    }))
}

/**
 * Normalize stored columns: keep real active statuses, partition each status
 * to exactly one column (first wins), and append a default column for any
 * active status left uncovered so no jobs can silently vanish.
 */
function sanitizeColumns(stored: any[], fallbackStages: ProductionStageConfig[], activeStatuses: string[] = activeColumnStatuses()): ProductionColumnConfig[] {
  const active = new Set<string>(activeStatuses)
  const seen = new Set<string>()
  const columns: ProductionColumnConfig[] = []
  let order = 0
  for (const c of stored) {
    if (!c || typeof c !== 'object') continue
    const statuses = (Array.isArray(c.statuses) ? c.statuses : [])
      .filter((s: any) => typeof s === 'string' && active.has(s) && !seen.has(s)) as JobStatusValue[]
    statuses.forEach((s) => seen.add(s))
    columns.push({
      id: typeof c.id === 'string' && c.id ? c.id : `col_${order}_${Math.random().toString(36).slice(2, 7)}`,
      displayName: typeof c.displayName === 'string' ? c.displayName : 'Column',
      color: typeof c.color === 'string' ? c.color : '#64748b',
      icon: typeof c.icon === 'string' ? c.icon : 'Circle',
      order: Number.isFinite(c.order) ? Number(c.order) : order,
      visible: typeof c.visible === 'boolean' ? c.visible : true,
      showJobCount: typeof c.showJobCount === 'boolean' ? c.showJobCount : true,
      defaultSort: typeof c.defaultSort === 'string' ? c.defaultSort : 'lastUpdated',
      defaultSortDir: c.defaultSortDir === 'asc' || c.defaultSortDir === 'desc' ? c.defaultSortDir : 'desc',
      statuses,
      agingEnabled: typeof c.agingEnabled === 'boolean' ? c.agingEnabled : false,
      agingDays: Number.isFinite(Number(c.agingDays)) ? Math.min(365, Math.max(1, Math.round(Number(c.agingDays)))) : 7,
    })
    order++
  }
  // Any active status not covered anywhere gets its own column so jobs show up.
  for (const s of fallbackStages) {
    if (!active.has(s.status) || seen.has(s.status)) continue
    columns.push({
      id: `col_${s.status}`, displayName: s.displayName, color: s.color, icon: s.icon,
      order: order++, visible: s.visible, showJobCount: s.showJobCount,
      defaultSort: s.defaultSort, defaultSortDir: s.defaultSortDir, statuses: [s.status],
      agingEnabled: false, agingDays: 7,
    })
    seen.add(s.status)
  }
  return columns.sort((a, b) => a.order - b.order).map((c, i) => ({ ...c, order: i }))
}

/** Build the full default config from the existing status map. */
export function buildDefaultProductionConfig(): ProductionConfig {
  const stages: ProductionStageConfig[] = DEFAULT_STAGE_ORDER.map((status, i) => {
    const info = PRODUCTION_STATUS_MAP[status]
    return {
      status,
      displayName: info.boardLabel,
      description: info.stage,
      color: jobStatusHexColors[status] || '#64748b',
      icon: DEFAULT_STATUS_ICON[status] || 'Circle',
      order: i,
      visible: true,
      showJobCount: true,
      defaultSort: 'lastUpdated' as ProductionSortKey,
      defaultSortDir: 'desc' as ProductionSortDir,
      nextAction: info.nextAction,
    }
  })

  const automation = {} as Record<JobStatusValue, ProductionAutomationConfig>
  for (const status of ALL_STATUSES) automation[status] = defaultAutomation()

  const filters: Record<ProductionFilterKey, boolean> = {
    search: true,
    assignedTo: true,
    priority: true,
    dueDate: true,
    client: false,
    jobType: false,
    jobSiteAddress: false,
    status: true,
    overdue: true,
  }

  return { version: PRODUCTION_CONFIG_VERSION, columns: buildColumnsFromStages(stages), stages, customStatuses: [], hiddenBuiltinStatuses: [], builtinStatusOverrides: {}, card: defaultCard(), filters, automation }
}

/** A board stage synthesized from a tenant-defined custom status. */
function stageFromCustom(opt: JobStatusOption, order: number): ProductionStageConfig {
  return {
    status: opt.value as JobStatusValue,
    displayName: opt.label,
    description: opt.label,
    color: opt.color,
    icon: 'Circle',
    order,
    visible: true,
    showJobCount: true,
    defaultSort: 'lastUpdated',
    defaultSortDir: 'desc',
    nextAction: '',
  }
}

/**
 * Merge a stored (possibly partial / older) tenant config over the defaults,
 * so new fields always have a value and the status set always matches the
 * current JobStatus enum (new statuses get defaults; removed ones are dropped).
 */
export function mergeProductionConfig(stored: any): ProductionConfig {
  const base = buildDefaultProductionConfig()
  if (!stored || typeof stored !== 'object') return base

  // Stages: start from defaults keyed by status, overlay stored values, keep
  // only real JobStatus values, and re-sort by (possibly overridden) order.
  const storedStages: any[] = Array.isArray(stored.stages) ? stored.stages : []
  const storedByStatus = new Map<string, any>()
  for (const s of storedStages) if (s && typeof s.status === 'string') storedByStatus.set(s.status, s)

  // Tenant-defined custom statuses (validated + de-duplicated against built-ins).
  const customStatuses: JobStatusOption[] = (() => {
    const raw = Array.isArray(stored.customStatuses) ? stored.customStatuses : []
    const seen = new Set<string>(ALL_STATUSES as string[])
    const out: JobStatusOption[] = []
    for (const c of raw) {
      if (!c || typeof c !== 'object') continue
      const value = typeof c.value === 'string' ? c.value : ''
      if (!STATUS_VALUE_RE.test(value) || seen.has(value)) continue
      seen.add(value)
      out.push({
        value,
        label: typeof c.label === 'string' && c.label.trim() ? c.label.trim().slice(0, 40) : value.replaceAll('_', ' '),
        color: typeof c.color === 'string' ? c.color : '#64748b',
      })
      if (out.length >= 50) break
    }
    return out
  })()

  const builtinStages = base.stages.map((def) => {
    const s = storedByStatus.get(def.status)
    if (!s) return def
    return {
      ...def,
      displayName: typeof s.displayName === 'string' ? s.displayName : def.displayName,
      description: typeof s.description === 'string' ? s.description : def.description,
      color: typeof s.color === 'string' ? s.color : def.color,
      icon: typeof s.icon === 'string' ? s.icon : def.icon,
      order: Number.isFinite(s.order) ? Number(s.order) : def.order,
      visible: typeof s.visible === 'boolean' ? s.visible : def.visible,
      showJobCount: typeof s.showJobCount === 'boolean' ? s.showJobCount : def.showJobCount,
      defaultSort: typeof s.defaultSort === 'string' ? s.defaultSort : def.defaultSort,
      defaultSortDir: s.defaultSortDir === 'asc' || s.defaultSortDir === 'desc' ? s.defaultSortDir : def.defaultSortDir,
      nextAction: typeof s.nextAction === 'string' ? s.nextAction : def.nextAction,
    }
  })
  // Append a stage for each custom status, applying any stored overrides (label/color/order/visible).
  const customStages = customStatuses.map((opt, i) => {
    const s = storedByStatus.get(opt.value)
    const base = stageFromCustom(opt, builtinStages.length + i)
    if (!s) return base
    return {
      ...base,
      displayName: typeof s.displayName === 'string' ? s.displayName : base.displayName,
      color: typeof s.color === 'string' ? s.color : base.color,
      icon: typeof s.icon === 'string' ? s.icon : base.icon,
      order: Number.isFinite(s.order) ? Number(s.order) : base.order,
      visible: typeof s.visible === 'boolean' ? s.visible : base.visible,
      showJobCount: typeof s.showJobCount === 'boolean' ? s.showJobCount : base.showJobCount,
      nextAction: typeof s.nextAction === 'string' ? s.nextAction : base.nextAction,
    }
  })
  const stages = [...builtinStages, ...customStages].sort((a, b) => a.order - b.order)

  // Removed built-in statuses (only real built-in values count).
  const hiddenBuiltinStatuses: string[] = Array.isArray(stored.hiddenBuiltinStatuses)
    ? Array.from(
        new Set(
          stored.hiddenBuiltinStatuses.filter(
            (v: any) => typeof v === 'string' && (ALL_STATUSES as string[]).includes(v)
          )
        )
      )
    : []

  // Per built-in status label/color overrides (only real built-in values).
  const builtinStatusOverrides: Record<string, { label?: string; color?: string }> = {}
  if (stored.builtinStatusOverrides && typeof stored.builtinStatusOverrides === 'object') {
    for (const value of ALL_STATUSES as string[]) {
      const o = stored.builtinStatusOverrides[value]
      if (!o || typeof o !== 'object') continue
      const entry: { label?: string; color?: string } = {}
      if (typeof o.label === 'string' && o.label.trim()) entry.label = o.label.trim().slice(0, 40)
      if (typeof o.color === 'string') entry.color = o.color
      if (entry.label || entry.color) builtinStatusOverrides[value] = entry
    }
  }

  const activeStatuses = activeColumnStatuses({ customStatuses, hiddenBuiltinStatuses })

  // Card
  const sc = stored.card && typeof stored.card === 'object' ? stored.card : {}
  const storedFields: any[] = Array.isArray(sc.fields) ? sc.fields : []
  const fieldByKey = new Map<string, any>()
  for (const f of storedFields) if (f && typeof f.key === 'string') fieldByKey.set(f.key, f)
  const fields = base.card.fields.map((def) => {
    const f = fieldByKey.get(def.key)
    if (!f) return def
    return {
      key: def.key,
      visible: typeof f.visible === 'boolean' ? f.visible : def.visible,
      order: Number.isFinite(f.order) ? Number(f.order) : def.order,
    }
  }).sort((a, b) => a.order - b.order)

  const card: ProductionCardConfig = {
    density: ['compact', 'standard', 'detailed'].includes(sc.density) ? sc.density : base.card.density,
    width: Number.isFinite(sc.width) ? Math.min(420, Math.max(220, Number(sc.width))) : base.card.width,
    borderStyle: ['none', 'left-accent', 'full'].includes(sc.borderStyle) ? sc.borderStyle : base.card.borderStyle,
    showStatusBadge: typeof sc.showStatusBadge === 'boolean' ? sc.showStatusBadge : base.card.showStatusBadge,
    showNextAction: typeof sc.showNextAction === 'boolean' ? sc.showNextAction : base.card.showNextAction,
    emphasizeJobNumber: typeof sc.emphasizeJobNumber === 'boolean' ? sc.emphasizeJobNumber : base.card.emphasizeJobNumber,
    showAddress: typeof sc.showAddress === 'boolean' ? sc.showAddress : base.card.showAddress,
    showAssignedUser: typeof sc.showAssignedUser === 'boolean' ? sc.showAssignedUser : base.card.showAssignedUser,
    showDueDate: typeof sc.showDueDate === 'boolean' ? sc.showDueDate : base.card.showDueDate,
    accentFromStageColor: typeof sc.accentFromStageColor === 'boolean' ? sc.accentFromStageColor : base.card.accentFromStageColor,
    fields,
  }

  // Filters
  const filters = { ...base.filters }
  if (stored.filters && typeof stored.filters === 'object') {
    for (const k of Object.keys(filters) as ProductionFilterKey[]) {
      if (typeof stored.filters[k] === 'boolean') filters[k] = stored.filters[k]
    }
  }

  // Automation
  const automation: Record<string, ProductionAutomationConfig> = { ...base.automation }
  for (const status of [...(ALL_STATUSES as string[]), ...customStatuses.map((c) => c.value)]) {
    const a = stored.automation && typeof stored.automation === 'object' ? stored.automation[status] : null
    if (a && typeof a === 'object') {
      automation[status] = {
        moveToColumn: true,
        updateStage: true,
        updateNextAction: true,
        createTask: typeof a.createTask === 'boolean' ? a.createTask : false,
        createTaskTitle: typeof a.createTaskTitle === 'string' ? a.createTaskTitle : '',
        notifyAssignedUser: typeof a.notifyAssignedUser === 'boolean' ? a.notifyAssignedUser : false,
      }
    } else if (!automation[status]) {
      automation[status] = defaultAutomation()
    }
  }

  // Columns: use stored columns when present (sanitized/partitioned); otherwise
  // derive one column per active stage (also migrates older v1 configs).
  const columns = Array.isArray(stored.columns) && stored.columns.length
    ? sanitizeColumns(stored.columns, stages, activeStatuses)
    : buildColumnsFromStages(stages, activeStatuses)

  return { version: PRODUCTION_CONFIG_VERSION, columns, stages, customStatuses, hiddenBuiltinStatuses, builtinStatusOverrides, card, filters, automation }
}

/** Effective production info for a status, with tenant display overrides applied. */
export function resolveProductionInfo(status: string, config: ProductionConfig) {
  const base = PRODUCTION_STATUS_MAP[status as JobStatusValue] || PRODUCTION_STATUS_MAP.QUOTE
  const stage = config.stages.find((s) => s.status === status)
  return {
    ...base,
    stage: stage?.description || base.stage,
    boardLabel: stage?.displayName || base.boardLabel,
    nextAction: stage?.nextAction || base.nextAction,
  }
}
