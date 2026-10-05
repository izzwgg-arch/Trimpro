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

export interface ProductionConfig {
  version: number
  stages: ProductionStageConfig[]
  card: ProductionCardConfig
  filters: Record<ProductionFilterKey, boolean>
  automation: Record<JobStatusValue, ProductionAutomationConfig>
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

  return { version: PRODUCTION_CONFIG_VERSION, stages, card: defaultCard(), filters, automation }
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

  const stages = base.stages.map((def) => {
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
  }).sort((a, b) => a.order - b.order)

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
  const automation = { ...base.automation }
  if (stored.automation && typeof stored.automation === 'object') {
    for (const status of ALL_STATUSES) {
      const a = stored.automation[status]
      if (a && typeof a === 'object') {
        automation[status] = {
          moveToColumn: true,
          updateStage: true,
          updateNextAction: true,
          createTask: typeof a.createTask === 'boolean' ? a.createTask : false,
          createTaskTitle: typeof a.createTaskTitle === 'string' ? a.createTaskTitle : '',
          notifyAssignedUser: typeof a.notifyAssignedUser === 'boolean' ? a.notifyAssignedUser : false,
        }
      }
    }
  }

  return { version: PRODUCTION_CONFIG_VERSION, stages, card, filters, automation }
}

/** Effective production info for a status, with tenant display overrides applied. */
export function resolveProductionInfo(status: JobStatusValue, config: ProductionConfig) {
  const base = PRODUCTION_STATUS_MAP[status] || PRODUCTION_STATUS_MAP.QUOTE
  const stage = config.stages.find((s) => s.status === status)
  return {
    ...base,
    stage: stage?.description || base.stage,
    boardLabel: stage?.displayName || base.boardLabel,
    nextAction: stage?.nextAction || base.nextAction,
  }
}
