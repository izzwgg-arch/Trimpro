import { callPhone } from '../../lib/phone'
import React, { useEffect, useMemo, useState } from 'react'
import {
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { EmptyState } from '../../components/EmptyState'
import { apiRequest } from '../../api/client'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { JobsStackParamList } from '../../types/navigation'
import {
  AllWorkList,
  PipelineCard,
  PipelineSheet,
  type PipelineItem,
  type PipelineResponse,
} from '../../components/production/PipelineViews'

type Props = NativeStackScreenProps<JobsStackParamList, 'Production'>

// estimates / invoices / all are the Estimate & Invoice pipelines and the All Work overview.
type BoardKey = 'jobs' | 'tasks' | 'leads' | 'estimates' | 'invoices' | 'all'
const PIPELINE_TABS: BoardKey[] = ['estimates', 'invoices', 'all']

// ---- types mirroring the /api/production response (same as the web board) ----
interface ProductionJob {
  id: string
  jobNumber: string
  title: string
  status: string
  priority: number
  jobType?: string | null
  scheduledEnd: string | null
  createdAt?: string | null
  estimateAmount: string | null
  invoiceAmount?: number | null
  billingStatus?: string | null
  poCount?: number | null
  client: { id: string; name: string; companyName: string | null } | null
  assignments: Array<{ id: string; user: { id: string; firstName: string; lastName: string } }>
  addresses: Array<{ id: string; street: string | null; city: string | null }>
  production: { stage: string; nextAction: string }
}
// Same sort options as the web production line (lib/production/config.ts).
type SortKey =
  | 'dueDate'
  | 'priority'
  | 'createdDate'
  | 'jobNumber'
  | 'client'
  | 'jobSiteAddress'
  | 'assignedUser'
  | 'lastUpdated'
type SortDir = 'asc' | 'desc'

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'dueDate', label: 'Due Date' },
  { value: 'priority', label: 'Priority' },
  { value: 'createdDate', label: 'Created Date' },
  { value: 'jobNumber', label: 'Job Number' },
  { value: 'client', label: 'Client' },
  { value: 'jobSiteAddress', label: 'Job Site Address' },
  { value: 'assignedUser', label: 'Assigned User' },
  { value: 'lastUpdated', label: 'Last Updated' },
]
const sortLabel = (key: SortKey) => SORT_OPTIONS.find((o) => o.value === key)?.label || 'Last Updated'

interface ColumnConfig {
  id: string
  displayName: string
  color: string
  icon: string
  order: number
  visible: boolean
  showJobCount: boolean
  defaultSort: SortKey
  defaultSortDir: SortDir
  statuses: string[]
}
interface CardFieldConfig { key: string; visible: boolean; order: number }
interface CardConfig {
  density: 'compact' | 'comfortable' | 'detailed'
  width: number
  borderStyle: 'none' | 'left-accent' | 'full'
  showStatusBadge: boolean
  showNextAction: boolean
  emphasizeJobNumber: boolean
  showAddress: boolean
  showAssignedUser: boolean
  showDueDate: boolean
  accentFromStageColor: boolean
  fields: CardFieldConfig[]
}
interface StageConfig { status: string; displayName: string; color: string; visible: boolean }
interface ProductionConfig {
  columns: ColumnConfig[]
  stages: StageConfig[]
  card: CardConfig
  filters?: Partial<Record<'search' | 'status' | 'assignedTo' | 'priority' | 'dueDate' | 'overdue', boolean>>
}

// ---- jobs filters (same choices as the web Production page, plus client / job type) ----
type DueFilter = 'all' | 'overdue' | 'today' | 'week'
interface JobFilters {
  status: string
  assignedTo: string
  priority: string
  due: DueFilter
  client: string
  jobType: string
  // null = each column keeps its own configured sort (the web default).
  sort: { key: SortKey; dir: SortDir } | null
}
const EMPTY_FILTERS: JobFilters = { status: 'all', assignedTo: 'all', priority: 'all', due: 'all', client: 'all', jobType: 'all', sort: null }
const JOB_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'QUOTE', label: 'Quote' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'MEASURED', label: 'Measured' },
  { value: 'NEED_TO_ORDER', label: 'Need to order' },
  { value: 'ORDERED', label: 'Ordered' },
  { value: 'INSTALLATION_COMPLETE', label: 'Installation complete' },
  { value: 'NEED_TOUCH_UPS', label: 'Need touch ups' },
  { value: 'FINISHING_COMPLETE', label: 'Finishing complete' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'INVOICED', label: 'Invoiced' },
]
const DUE_OPTIONS: Array<{ value: DueFilter; label: string }> = [
  { value: 'all', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due this week' },
]
const prettyType = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Same rules as the web Production page's filters. */
function jobMatchesFilters(job: ProductionJob, f: JobFilters, today: Date): boolean {
  if (f.status !== 'all' && job.status !== f.status) return false
  if (f.assignedTo !== 'all' && !job.assignments.some((a) => a.user?.id === f.assignedTo)) return false
  if (f.priority !== 'all' && String(job.priority) !== f.priority) return false
  if (f.client !== 'all' && job.client?.id !== f.client) return false
  if (f.jobType !== 'all' && (job.jobType || '') !== f.jobType) return false
  if (f.due !== 'all') {
    if (!job.scheduledEnd) return false
    const due = new Date(job.scheduledEnd)
    if (Number.isNaN(due.getTime())) return false
    if (f.due === 'overdue' && !(due < today && !sameDay(due, today))) return false
    if (f.due === 'today' && !sameDay(due, today)) return false
    if (f.due === 'week') {
      const weekOut = new Date(today)
      weekOut.setDate(weekOut.getDate() + 7)
      if (due < today || due > weekOut) return false
    }
  }
  return true
}

function activeFilterCount(f: JobFilters): number {
  return (['status', 'assignedTo', 'priority', 'due', 'client', 'jobType'] as const).filter((k) => f[k] !== 'all').length + (f.sort ? 1 : 0)
}
interface ProductionResponse {
  jobs: ProductionJob[]
  counts: Record<string, number>
  config: ProductionConfig
}

// ---- Tasks / Requests boards ------------------------------------------------
interface TaskItem {
  id: string
  title: string
  status: string
  priority?: string | number | null
  dueDate?: string | null
  assignee?: { firstName?: string | null; lastName?: string | null } | null
  assignments?: Array<{ user?: { firstName?: string | null; lastName?: string | null } | null }>
  job?: { jobNumber?: string | null } | null
}
interface LeadItem {
  id: string
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  phone?: string | null
  email?: string | null
  status: string
  source?: string | null
  jobType?: string | null
  value?: number | string | null
  jobSiteAddress?: string | null
  createdAt?: string | null
  assignedTo?: { firstName?: string | null; lastName?: string | null } | null
}

interface BoardColumnDef { id: string; label: string; color: string; icon: string }

// Mirrors lib/production/boards.ts (shared with the web production line).
const TASK_BOARD_COLUMNS: BoardColumnDef[] = [
  { id: 'TODO', label: 'To Do', color: '#64748b', icon: 'Circle' },
  { id: 'IN_PROGRESS', label: 'In Progress', color: '#eab308', icon: 'PlayCircle' },
  { id: 'COMPLETED', label: 'Completed', color: '#22c55e', icon: 'CheckCircle' },
]
const LEAD_BOARD_COLUMNS: BoardColumnDef[] = [
  { id: 'NEW', label: 'New', color: '#3b82f6', icon: 'Flag' },
  { id: 'CONTACTED', label: 'Contacted', color: '#0ea5e9', icon: 'PlayCircle' },
  { id: 'QUALIFIED', label: 'Qualified', color: '#6366f1', icon: 'CheckCircle' },
  { id: 'ESTIMATE_CREATED', label: 'Estimate Created', color: '#8b5cf6', icon: 'Ruler' },
  { id: 'ESTIMATE_SENT', label: 'Estimate Sent', color: '#a855f7', icon: 'Truck' },
  { id: 'FOLLOW_UP', label: 'Follow Up', color: '#d97706', icon: 'Clock' },
  { id: 'CONVERTED', label: 'Converted', color: '#16a34a', icon: 'CheckCircle' },
  { id: 'LOST', label: 'Lost', color: '#ef4444', icon: 'AlertCircle' },
]

// ---- per-user view preferences (shared schema with the web page) ------------
interface BoardViewPref { order: string[]; hidden: string[] }
type ViewPrefs = Partial<Record<BoardKey, BoardViewPref>>

/** Apply a user's personal order + hidden columns on top of the full set. */
function applyBoardPref<T extends { id: string }>(cols: T[], pref?: BoardViewPref): T[] {
  if (!pref) return cols
  const byId = new Map(cols.map((c) => [c.id, c]))
  const ordered: T[] = []
  for (const id of pref.order) {
    const col = byId.get(id)
    if (col) { ordered.push(col); byId.delete(id) }
  }
  for (const col of cols) if (byId.has(col.id)) ordered.push(col)
  const hidden = new Set(pref.hidden || [])
  return ordered.filter((c) => !hidden.has(c.id))
}

// Same hex palette the web board uses (lib/jobs/statuses.jobStatusHexColors).
const STATUS_HEX: Record<string, string> = {
  QUOTE: '#94a3b8', SCHEDULED: '#3b82f6', IN_PROGRESS: '#eab308', MEASURED: '#6366f1',
  NEED_TO_ORDER: '#d97706', ORDERED: '#0ea5e9', INSTALLATION_COMPLETE: '#06b6d4',
  NEED_TOUCH_UPS: '#d946ef', FINISHING_COMPLETE: '#14b8a6', ON_HOLD: '#f97316',
  COMPLETED: '#22c55e', CANCELLED: '#ef4444', INVOICED: '#a855f7',
}

// Map the web's lucide StageIcon keys to the closest Ionicons.
const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  Circle: 'ellipse-outline', CircleDot: 'radio-button-on', PlayCircle: 'play-circle-outline',
  Ruler: 'resize-outline', ShoppingCart: 'cart-outline', Truck: 'car-outline',
  Hammer: 'hammer-outline', Wrench: 'build-outline', CheckCircle: 'checkmark-circle-outline',
  PauseCircle: 'pause-circle-outline', Package: 'cube-outline', Clock: 'time-outline',
  AlertCircle: 'alert-circle-outline', Flag: 'flag-outline', Factory: 'business-outline', Boxes: 'albums-outline',
}
const iconFor = (name?: string): keyof typeof Ionicons.glyphMap => (name && ICON_MAP[name]) || 'ellipse-outline'

const SCREEN_W = Dimensions.get('window').width

/**
 * Sort one board column's jobs — same rules as the web board's sortJobs.
 * `list` arrives in the API's order (most recently updated first), which is what
 * "Last Updated" uses; jobs without a value for the chosen field go last.
 */
function sortJobs(list: ProductionJob[], key: SortKey, dir: SortDir): ProductionJob[] {
  const mul = dir === 'asc' ? 1 : -1
  const apiIndex = new Map(list.map((j, i) => [j.id, i]))
  const time = (v?: string | null): number | null => {
    if (!v) return null
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? null : t
  }
  const val = (j: ProductionJob): number | string | null => {
    switch (key) {
      case 'dueDate': return time(j.scheduledEnd)
      case 'priority': return j.priority || 0
      case 'createdDate': return time(j.createdAt)
      case 'jobNumber': return j.jobNumber || ''
      case 'client': return (j.client?.companyName || j.client?.name || '').toLowerCase()
      case 'jobSiteAddress': return (j.addresses?.[0]?.street || '').toLowerCase()
      case 'assignedUser': return (j.assignments?.[0]?.user?.firstName || '').toLowerCase()
      case 'lastUpdated': default: return -(apiIndex.get(j.id) ?? 0)
    }
  }
  return [...list].sort((a, b) => {
    const va = val(a)
    const vb = val(b)
    if (va === null && vb === null) return 0
    if (va === null) return 1 // missing values always last
    if (vb === null) return -1
    if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * mul
    return (va - vb) * mul
  })
}

function money(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return ''
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function isOverdue(v?: string | null): boolean {
  if (!v) return false
  const d = new Date(v)
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now()
}
// 15%-opacity tint of a hex color for badge backgrounds.
function tint(hex: string): string {
  return hex.length === 7 ? `${hex}26` : hex
}

export function ProductionScreen({ navigation }: Props) {
  const { hasWebPermission, canViewRequests } = useMobilePermissions()
  const canViewTasks = hasWebPermission('tasks.view')
  const canViewLeads = canViewRequests()
  const canManageProduction = hasWebPermission('production.manage')
  const canViewEstimates = hasWebPermission('estimates.view')
  const canViewInvoices = hasWebPermission('invoices.view')

  const [tab, setTab] = useState<BoardKey>('jobs')
  const [search, setSearch] = useState('')
  const [archiveView, setArchiveView] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState<JobFilters>(EMPTY_FILTERS)
  const [pipelineItem, setPipelineItem] = useState<PipelineItem | null>(null)

  // ---- per-user view preferences ----
  const prefsQuery = useQuery({
    queryKey: ['production-view-prefs'],
    queryFn: () => apiRequest<{ prefs: ViewPrefs }>(`/api/production/view-preferences`),
    staleTime: 5 * 60_000,
  })
  const [prefs, setPrefs] = useState<ViewPrefs>({})
  useEffect(() => {
    if (prefsQuery.data?.prefs) setPrefs(prefsQuery.data.prefs)
  }, [prefsQuery.data])

  const saveViewPref = async (board: BoardKey, pref: BoardViewPref) => {
    const next: ViewPrefs = { ...prefs, [board]: pref }
    setPrefs(next)
    try {
      await apiRequest(`/api/production/view-preferences`, 'PUT', { prefs: next })
    } catch {
      // keep the optimistic local view even if the save fails
    }
  }

  // ---- jobs board ----
  const query = useQuery({
    queryKey: ['production-board', archiveView],
    queryFn: () => apiRequest<ProductionResponse>(`/api/production${archiveView ? '?view=archive' : ''}`),
    refetchInterval: 60_000,
  })

  // ---- tasks board (scoped to the signed-in user) ----
  const tasksQuery = useQuery({
    queryKey: ['production-tasks'],
    queryFn: () => apiRequest<{ tasks: TaskItem[] }>(`/api/tasks?filter=assigned&limit=500&mobile=true`),
    enabled: tab === 'tasks' && canViewTasks,
  })

  // ---- requests (leads) board (scoped to the signed-in user) ----
  const leadsQuery = useQuery({
    queryKey: ['production-leads'],
    queryFn: () => apiRequest<{ leads: LeadItem[] }>(`/api/leads?mine=1&limit=500`),
    enabled: tab === 'leads' && canViewLeads,
  })

  // ---- estimate / invoice pipelines and All Work (stages come from the records' real status) ----
  const isPipelineTab = PIPELINE_TABS.includes(tab)
  const pipelineQuery = useQuery({
    queryKey: ['production-pipelines', tab],
    queryFn: () => apiRequest<PipelineResponse>(`/api/production/pipelines?board=${tab}`),
    enabled: isPipelineTab,
    refetchInterval: 60_000,
  })
  const peopleQuery = useQuery({
    queryKey: ['production-pipeline-people'],
    queryFn: () => apiRequest<{ teamMembers: Array<{ id: string; firstName: string; lastName: string }> }>('/api/schedules/team'),
    enabled: isPipelineTab,
    staleTime: 5 * 60_000,
  })
  const savePipelineState = async (item: PipelineItem, changes: Record<string, unknown>) => {
    await apiRequest('/api/production/pipelines/state', 'PUT', { recordType: item.type, recordId: item.id, ...changes })
    await pipelineQuery.refetch()
  }

  const jobs = query.data?.jobs ?? []
  const config = query.data?.config

  const visibleJobs = useMemo(() => {
    const term = search.trim().toLowerCase()
    const today = new Date()
    const list = jobs.filter((job) => {
      if (!jobMatchesFilters(job, filters, today)) return false
      if (!term) return true
      const a = job.addresses?.[0]
      return [job.jobNumber, job.title, job.client?.companyName, job.client?.name, a?.street, a?.city]
        .filter(Boolean).join(' ').toLowerCase().includes(term)
    })
    // The archive list and On Hold strip follow a chosen sort too.
    return filters.sort ? sortJobs(list, filters.sort.key, filters.sort.dir) : list
  }, [jobs, search, filters])

  // Choices for the filter sheet come from the jobs on the board.
  const filterOptions = useMemo(() => {
    const people = new Map<string, string>()
    const clients = new Map<string, string>()
    const types = new Set<string>()
    for (const j of jobs) {
      for (const a of j.assignments || []) {
        if (a.user?.id) people.set(a.user.id, `${a.user.firstName || ''} ${a.user.lastName || ''}`.trim() || 'Unknown')
      }
      if (j.client?.id) clients.set(j.client.id, j.client.companyName || j.client.name || 'Client')
      if (j.jobType) types.add(j.jobType)
    }
    const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)
    return {
      people: Array.from(people, ([value, label]) => ({ value, label })).sort(byLabel),
      clients: Array.from(clients, ([value, label]) => ({ value, label })).sort(byLabel),
      jobTypes: Array.from(types, (value) => ({ value, label: prettyType(value) })).sort(byLabel),
    }
  }, [jobs])
  const filterCount = activeFilterCount(filters)

  // Search also works on the Tasks and Requests tabs.
  const searchTerm = search.trim().toLowerCase()
  const matchesTask = (t: TaskItem) =>
    !searchTerm ||
    [
      t.title,
      t.job?.jobNumber,
      t.assignee?.firstName,
      t.assignee?.lastName,
      ...(t.assignments || []).flatMap((a) => [a.user?.firstName, a.user?.lastName]),
    ]
      .filter(Boolean).join(' ').toLowerCase().includes(searchTerm)
  const matchesLead = (l: LeadItem) =>
    !searchTerm ||
    [l.firstName, l.lastName, l.company, l.phone, l.email, l.jobSiteAddress, l.source, l.jobType]
      .filter(Boolean).join(' ').toLowerCase().includes(searchTerm)

  const columns = useMemo(() => {
    const cols = (config?.columns || []).filter((c) => c.visible).sort((a, b) => a.order - b.order)
    const withJobs = cols.map((col) => ({
      id: col.id,
      col,
      // Each column is sorted by its own configured sort, exactly like the web board.
      jobs: sortJobs(
        visibleJobs.filter((j) => j.status !== 'ON_HOLD' && col.statuses.includes(j.status)),
        filters.sort?.key || col.defaultSort || 'lastUpdated',
        filters.sort?.dir || col.defaultSortDir || 'desc'
      ),
    }))
    return applyBoardPref(withJobs, prefs.jobs) // user's personal order/hidden
  }, [config, visibleJobs, prefs.jobs, filters.sort])

  const onHoldStage = config?.stages?.find((s) => s.status === 'ON_HOLD')
  const onHoldJobs = useMemo(() => visibleJobs.filter((j) => j.status === 'ON_HOLD'), [visibleJobs])

  // ---- tasks grouped into columns ----
  const tasks = tasksQuery.data?.tasks ?? []
  const taskColumns = useMemo(() => applyBoardPref(TASK_BOARD_COLUMNS, prefs.tasks), [prefs.tasks])
  const tasksByCol = useMemo(() => {
    const m: Record<string, TaskItem[]> = {}
    for (const c of TASK_BOARD_COLUMNS) m[c.id] = []
    for (const t of tasks) {
      if (!matchesTask(t)) continue
      const s = String(t.status || '').toUpperCase(); (m[s] = m[s] || []).push(t)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, searchTerm])

  // ---- leads grouped into columns ----
  const leads = leadsQuery.data?.leads ?? []
  const leadColumns = useMemo(() => applyBoardPref(LEAD_BOARD_COLUMNS, prefs.leads), [prefs.leads])
  const leadsByCol = useMemo(() => {
    const m: Record<string, LeadItem[]> = {}
    for (const c of LEAD_BOARD_COLUMNS) m[c.id] = []
    for (const l of leads) {
      if (!matchesLead(l)) continue
      const s = String(l.status || '').toUpperCase(); (m[s] = m[s] || []).push(l)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, searchTerm])

  const pipelineConfig = pipelineQuery.data?.config
  const pipelineItems = useMemo(() => {
    const all = pipelineQuery.data?.items ?? []
    if (!searchTerm) return all
    return all.filter((i) =>
      [i.number, i.title, i.client?.name, i.jobSiteAddress, i.related.job?.jobNumber, i.responsible?.name]
        .filter(Boolean).join(' ').toLowerCase().includes(searchTerm)
    )
  }, [pipelineQuery.data, searchTerm])
  const pipelineStages = useMemo(() => {
    if (tab !== 'estimates' && tab !== 'invoices') return [] as BoardColumnDef[]
    const stages = (pipelineConfig?.[tab].stages || []).filter((st) => st.visible).sort((a, b) => a.order - b.order)
    return stages.map((st) => ({ id: st.id, label: st.label, color: st.color, icon: st.icon }))
  }, [pipelineConfig, tab])
  const pipelineColumns = useMemo(() => applyBoardPref(pipelineStages, prefs[tab]), [pipelineStages, prefs, tab])
  const pipelineByCol = useMemo(() => {
    const m: Record<string, PipelineItem[]> = {}
    for (const it of pipelineItems) (m[it.stage] = m[it.stage] || []).push(it)
    for (const k of Object.keys(m)) m[k].sort((a, b) => Number(b.followUpOverdue) - Number(a.followUpOverdue) || (b.daysInStage ?? 0) - (a.daysInStage ?? 0))
    return m
  }, [pipelineItems])

  // What the Customize modal edits for the active tab.
  const customizeCols: BoardColumnDef[] =
    tab === 'jobs'
      ? (config?.columns || []).filter((c) => c.visible).sort((a, b) => a.order - b.order).map((c) => ({ id: c.id, label: c.displayName, color: c.color, icon: c.icon }))
      : tab === 'tasks'
        ? TASK_BOARD_COLUMNS
        : tab === 'estimates' || tab === 'invoices'
          ? pipelineStages
          : LEAD_BOARD_COLUMNS
  const customizePref: BoardViewPref = prefs[tab] || { order: [], hidden: [] }

  const colWidth = config ? Math.min(config.card.width, SCREEN_W * 0.86) : SCREEN_W * 0.86
  const openJob = (id: string) => navigation.navigate('AdminJobDetail', { jobId: id })
  const openRequest = (id: string) => navigation.navigate('RequestDetail', { requestId: id })
  // Tasks live in their own tab stack; hop across to the task detail.
  const openTask = (id: string) => {
    const parent: any = navigation.getParent()
    if (parent) parent.navigate('TasksTab', { screen: 'TaskDetail', params: { taskId: id } })
  }

  const tabs: Array<{ key: BoardKey; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
    { key: 'jobs', label: 'Production', icon: 'construct-outline' },
    ...(canViewTasks ? [{ key: 'tasks' as BoardKey, label: 'Tasks', icon: 'checkbox-outline' as keyof typeof Ionicons.glyphMap }] : []),
    ...(canViewLeads ? [{ key: 'leads' as BoardKey, label: 'Requests', icon: 'megaphone-outline' as keyof typeof Ionicons.glyphMap }] : []),
    ...(canViewEstimates ? [{ key: 'estimates' as BoardKey, label: 'Estimates', icon: 'document-text-outline' as keyof typeof Ionicons.glyphMap }] : []),
    ...(canViewInvoices ? [{ key: 'invoices' as BoardKey, label: 'Invoices', icon: 'receipt-outline' as keyof typeof Ionicons.glyphMap }] : []),
    { key: 'all', label: 'All Work', icon: 'layers-outline' },
  ]

  return (
    <AppScreen padded={false}>
      {/* Tab bar: Production | Tasks | Requests */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBarScroll} contentContainerStyle={styles.tabBar}>
        {tabs.map((t) => {
          const active = tab === t.key
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tabItem, active && styles.tabItemActive]}>
              <Ionicons name={t.icon} size={15} color={active ? colors.brandPrimary : colors.textSecondary} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {/* Controls (search + customize, and archive on the jobs tab) */}
      <View style={styles.controlsRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder={
              tab === 'jobs'
                ? 'Search jobs…'
                : tab === 'tasks'
                  ? 'Search tasks…'
                  : tab === 'leads'
                    ? 'Search requests…'
                    : tab === 'estimates'
                      ? 'Search estimates…'
                      : tab === 'invoices'
                        ? 'Search invoices…'
                        : 'Search all work…'
            }
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        {tab === 'jobs' && (
          <Pressable
            style={[styles.iconButton, filterCount > 0 && styles.iconButtonActive]}
            onPress={() => setFiltersOpen(true)}
            hitSlop={8}
            accessibilityLabel="Filter and sort"
          >
            <Ionicons name="funnel-outline" size={17} color={filterCount > 0 ? colors.surface : colors.brandPrimary} />
            {filterCount > 0 ? (
              <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{filterCount}</Text></View>
            ) : null}
          </Pressable>
        )}
        {tab === 'jobs' && !archiveView && (
          <Pressable style={styles.iconButton} onPress={() => setSortOpen(true)} hitSlop={8} accessibilityLabel="Column sorting">
            <Ionicons name="swap-vertical-outline" size={18} color={colors.brandPrimary} />
          </Pressable>
        )}
        {tab !== 'all' && (
          <Pressable style={styles.iconButton} onPress={() => setCustomizeOpen(true)} hitSlop={8}>
            <Ionicons name="options-outline" size={18} color={colors.brandPrimary} />
          </Pressable>
        )}
        {tab === 'jobs' && (
          <Pressable style={[styles.archiveButton, archiveView && styles.archiveButtonActive]} onPress={() => setArchiveView((v) => !v)}>
            <Ionicons name="archive-outline" size={16} color={archiveView ? colors.surface : colors.brandPrimary} />
            <Text style={[styles.archiveButtonText, archiveView && styles.archiveButtonTextActive]}>{archiveView ? 'Board' : 'Archive'}</Text>
          </Pressable>
        )}
      </View>

      {tab === 'jobs' && filterCount > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.activeFiltersScroll} contentContainerStyle={styles.activeFilters}>
          {activeFilterChips(filters, filterOptions).map((chip) => (
            <Pressable key={chip.key} style={styles.activeChip} onPress={() => setFilters((f) => ({ ...f, ...chip.clear }))}>
              <Text style={styles.activeChipText} numberOfLines={1}>{chip.label}</Text>
              <Ionicons name="close" size={13} color={colors.brandPrimary} />
            </Pressable>
          ))}
          <Pressable style={styles.clearChip} onPress={() => setFilters(EMPTY_FILTERS)}>
            <Text style={styles.clearChipText}>Clear all</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      {/* ---- JOBS TAB ---- */}
      {tab === 'jobs' && (
        query.isLoading || !config ? (
          <View style={styles.loadingWrap}><Text style={styles.loadingText}>Loading production board...</Text></View>
        ) : archiveView ? (
          <ScrollView contentContainerStyle={styles.archiveList} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}>
            {visibleJobs.length === 0 ? (
              <EmptyState icon="archive-outline" title="Nothing here" description="No completed, cancelled, or invoiced jobs match these filters." />
            ) : (
              visibleJobs.map((job) => {
                const stage = config.stages.find((s) => s.status === job.status)
                return <ProductionCard key={job.id} job={job} config={config} stageColor={stage?.color} onPress={() => openJob(job.id)} />
              })
            )}
          </ScrollView>
        ) : (
          <View style={styles.boardWrap}>
            {/* On Hold / Attention Needed — amber, like web (capped, scrolls on its own) */}
            {onHoldJobs.length > 0 && (onHoldStage?.visible ?? true) && (
              <View style={styles.onHoldSection}>
                <View style={styles.onHoldHeader}>
                  <Ionicons name="warning-outline" size={16} color="#B45309" />
                  <Text style={styles.onHoldTitle}>{onHoldStage?.displayName || 'On Hold'} / Attention Needed</Text>
                  <View style={styles.onHoldCount}><Text style={styles.onHoldCountText}>{onHoldJobs.length}</Text></View>
                </View>
                <ScrollView style={styles.onHoldScroll} nestedScrollEnabled contentContainerStyle={{ gap: spacing.xs }}>
                  {onHoldJobs.map((job) => (
                    <ProductionCard key={job.id} job={job} config={config} stageColor={onHoldStage?.color} onPress={() => openJob(job.id)} />
                  ))}
                </ScrollView>
              </View>
            )}

            <View style={styles.boardHeaderRow}>
              <Ionicons name="grid-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.boardHeaderText}>Production Board</Text>
            </View>

            {/* Horizontal columns; each column scrolls vertically on its own */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.boardScroll} contentContainerStyle={styles.boardRow}>
              {columns.map(({ col, jobs: colJobs }) => (
                <View key={col.id} style={[styles.column, { width: colWidth }]}>
                  <View style={[styles.columnHeader, { backgroundColor: col.color }]}>
                    <View style={styles.columnHeaderLeft}>
                      <Ionicons name={iconFor(col.icon)} size={16} color="#fff" />
                      <Text style={styles.columnTitle} numberOfLines={1}>{col.displayName}</Text>
                    </View>
                    {col.showJobCount && (
                      <View style={styles.columnCount}><Text style={styles.columnCountText}>{colJobs.length}</Text></View>
                    )}
                  </View>
                  <View style={styles.sortBar}>
                    <Ionicons name={(filters.sort?.dir || col.defaultSortDir) === 'asc' ? 'arrow-up' : 'arrow-down'} size={11} color={colors.textSecondary} />
                    <Text style={styles.sortBarText} numberOfLines={1}>{sortLabel(filters.sort?.key || col.defaultSort || 'lastUpdated')}</Text>
                  </View>
                  <FlatList
                    data={colJobs}
                    keyExtractor={(j) => j.id}
                    style={styles.columnBody}
                    contentContainerStyle={styles.columnBodyContent}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                    refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
                    ListEmptyComponent={<Text style={styles.noJobs}>No jobs</Text>}
                    renderItem={({ item: job }) => (
                      <ProductionCard job={job} config={config} stageColor={col.color} onPress={() => openJob(job.id)} />
                    )}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        )
      )}

      {/* ---- TASKS TAB ---- */}
      {tab === 'tasks' && (
        <StatusBoard
          columns={taskColumns}
          loading={tasksQuery.isLoading}
          refreshing={tasksQuery.isRefetching}
          onRefresh={() => tasksQuery.refetch()}
          colWidth={Math.min(320, SCREEN_W * 0.86)}
          countFor={(id) => (tasksByCol[id] || []).length}
          renderColumn={(id) => (
            <FlatList
              data={tasksByCol[id] || []}
              keyExtractor={(t) => t.id}
              style={styles.columnBody}
              contentContainerStyle={styles.columnBodyContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
              refreshControl={<RefreshControl refreshing={tasksQuery.isRefetching} onRefresh={() => tasksQuery.refetch()} />}
              ListEmptyComponent={<Text style={styles.noJobs}>No tasks</Text>}
              renderItem={({ item }) => <TaskCard task={item} onPress={() => openTask(item.id)} />}
            />
          )}
          emptyTitle="No tasks assigned to you"
        />
      )}

      {/* ---- REQUESTS TAB ---- */}
      {tab === 'leads' && (
        <StatusBoard
          columns={leadColumns}
          loading={leadsQuery.isLoading}
          refreshing={leadsQuery.isRefetching}
          onRefresh={() => leadsQuery.refetch()}
          colWidth={Math.min(300, SCREEN_W * 0.86)}
          countFor={(id) => (leadsByCol[id] || []).length}
          renderColumn={(id) => (
            <FlatList
              data={leadsByCol[id] || []}
              keyExtractor={(l) => l.id}
              style={styles.columnBody}
              contentContainerStyle={styles.columnBodyContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
              refreshControl={<RefreshControl refreshing={leadsQuery.isRefetching} onRefresh={() => leadsQuery.refetch()} />}
              ListEmptyComponent={<Text style={styles.noJobs}>No requests</Text>}
              renderItem={({ item }) => <LeadCard lead={item} onPress={() => openRequest(item.id)} />}
            />
          )}
          emptyTitle="No requests assigned to you"
        />
      )}

      {/* ---- ESTIMATES / INVOICES PIPELINES ---- */}
      {(tab === 'estimates' || tab === 'invoices') && (
        pipelineQuery.isError ? (
          <View style={styles.loadingWrap}>
            <EmptyState icon="alert-circle-outline" title="Could not load" description={(pipelineQuery.error as any)?.message || 'Pull to try again.'} />
          </View>
        ) : (
          <StatusBoard
            columns={pipelineColumns}
            loading={pipelineQuery.isLoading}
            refreshing={pipelineQuery.isRefetching}
            onRefresh={() => pipelineQuery.refetch()}
            colWidth={Math.min(300, SCREEN_W * 0.86)}
            countFor={(id) => (pipelineByCol[id] || []).length}
            renderColumn={(id) => (
              <FlatList
                data={pipelineByCol[id] || []}
                keyExtractor={(i) => i.id}
                style={styles.columnBody}
                contentContainerStyle={styles.columnBodyContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator
                refreshControl={<RefreshControl refreshing={pipelineQuery.isRefetching} onRefresh={() => pipelineQuery.refetch()} />}
                ListEmptyComponent={<Text style={styles.noJobs}>{tab === 'estimates' ? 'No estimates' : 'No invoices'}</Text>}
                renderItem={({ item }) => <PipelineCard item={item} onPress={() => setPipelineItem(item)} />}
              />
            )}
            emptyTitle={tab === 'estimates' ? 'No estimates' : 'No invoices'}
          />
        )
      )}

      {/* ---- ALL WORK ---- */}
      {tab === 'all' && (
        pipelineQuery.isLoading ? (
          <View style={styles.loadingWrap}><Text style={styles.loadingText}>Loading…</Text></View>
        ) : (
          <AllWorkList
            items={pipelineItems}
            refreshing={pipelineQuery.isRefetching}
            onRefresh={() => pipelineQuery.refetch()}
            onPress={(item) => (item.type === 'JOB' ? openJob(item.id) : setPipelineItem(item))}
          />
        )
      )}

      <JobFiltersModal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        value={filters}
        onApply={setFilters}
        options={filterOptions}
        flags={config?.filters}
      />

      <SortColumnsModal
        open={sortOpen}
        onClose={() => setSortOpen(false)}
        columns={(config?.columns || []).filter((c) => c.visible).sort((a, b) => a.order - b.order)}
        canManage={canManageProduction}
        onSaved={() => query.refetch()}
      />

      <CustomizeViewModal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        title={tab === 'jobs' ? 'Production' : tab === 'tasks' ? 'Tasks' : tab === 'estimates' ? 'Estimates' : tab === 'invoices' ? 'Invoices' : 'Requests'}
        columns={customizeCols}
        pref={customizePref}
        onSave={(p) => saveViewPref(tab, p)}
      />

      <PipelineSheet
        item={pipelineItem}
        config={pipelineConfig}
        people={peopleQuery.data?.teamMembers ?? []}
        onClose={() => setPipelineItem(null)}
        onSave={savePipelineState}
        onOpenJob={(jobId) => {
          setPipelineItem(null)
          openJob(jobId)
        }}
      />
    </AppScreen>
  )
}

// Generic status board (colored columns + per-column vertical list), matching
// the jobs board look. Used for the Tasks and Requests tabs.
function StatusBoard({
  columns,
  loading,
  refreshing,
  onRefresh,
  colWidth,
  countFor,
  renderColumn,
  emptyTitle,
}: {
  columns: BoardColumnDef[]
  loading: boolean
  refreshing: boolean
  onRefresh: () => void
  colWidth: number
  countFor: (id: string) => number
  renderColumn: (id: string) => React.ReactNode
  emptyTitle: string
}) {
  if (loading) {
    return <View style={styles.loadingWrap}><Text style={styles.loadingText}>Loading…</Text></View>
  }
  if (columns.length === 0) {
    return (
      <View style={styles.loadingWrap}>
        <EmptyState icon="eye-off-outline" title="All columns hidden" description="Use the options button to show columns again." />
      </View>
    )
  }
  return (
    <View style={styles.boardWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.boardScroll} contentContainerStyle={styles.boardRow}>
        {columns.map((col) => (
          <View key={col.id} style={[styles.column, { width: colWidth }]}>
            <View style={[styles.columnHeader, { backgroundColor: col.color }]}>
              <View style={styles.columnHeaderLeft}>
                <Ionicons name={iconFor(col.icon)} size={16} color="#fff" />
                <Text style={styles.columnTitle} numberOfLines={1}>{col.label}</Text>
              </View>
              <View style={styles.columnCount}><Text style={styles.columnCountText}>{countFor(col.id)}</Text></View>
            </View>
            {renderColumn(col.id)}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const TASK_STATUS_HEX: Record<string, string> = { TODO: '#64748b', IN_PROGRESS: '#eab308', COMPLETED: '#22c55e' }

function TaskCard({ task, onPress }: { task: TaskItem; onPress: () => void }) {
  const teamNames = (task.assignments || [])
    .map((a) => `${a.user?.firstName || ''} ${a.user?.lastName || ''}`.trim())
    .filter(Boolean)
  const primaryName = task.assignee ? `${task.assignee.firstName || ''} ${task.assignee.lastName || ''}`.trim() : ''
  const assignee = teamNames.length > 1 ? `${teamNames[0]} +${teamNames.length - 1}` : teamNames[0] || primaryName
  const overdue = isOverdue(task.dueDate)
  const accent = TASK_STATUS_HEX[String(task.status || '').toUpperCase()] || '#64748b'
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { padding: 12, borderLeftWidth: 3, borderLeftColor: accent, borderWidth: 1 }, pressed && styles.cardPressed]}>
      <Text style={[styles.jobTitle, { fontSize: 14 }]} numberOfLines={2}>{task.title}</Text>
      <View style={styles.badgeRow}>
        {task.priority != null && String(task.priority) !== '' && (
          <View style={styles.prBadge}><Text style={styles.prBadgeText}>{String(task.priority)}</Text></View>
        )}
      </View>
      <View style={styles.iconRow}>
        <Ionicons name="person-outline" size={12} color={colors.muted} />
        <Text style={[styles.metaMuted, { fontSize: 11 }]} numberOfLines={1}>{assignee || 'Unassigned'}</Text>
      </View>
      {task.dueDate ? (
        <View style={styles.iconRow}>
          <Ionicons name="calendar-outline" size={12} color={overdue ? colors.danger : colors.muted} />
          <Text style={[{ fontSize: 11 }, overdue ? styles.overdueMeta : styles.metaMuted]}>Due {fmtDate(task.dueDate)}</Text>
        </View>
      ) : null}
      {task.job?.jobNumber ? (
        <View style={styles.iconRow}>
          <Ionicons name="briefcase-outline" size={12} color={colors.muted} />
          <Text style={[styles.metaFaint, { fontSize: 11 }]}>Job {task.job.jobNumber}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const LEAD_STATUS_HEX: Record<string, string> = Object.fromEntries(LEAD_BOARD_COLUMNS.map((c) => [c.id, c.color]))

// Organized, jobs-style request card — the whole card and the phone row are tappable.
function LeadCard({ lead, onPress }: { lead: LeadItem; onPress: () => void }) {
  const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.company || 'Request'
  const assignee = lead.assignedTo ? `${lead.assignedTo.firstName || ''} ${lead.assignedTo.lastName || ''}`.trim() : ''
  const statusHex = LEAD_STATUS_HEX[String(lead.status || '').toUpperCase()] || '#6b7280'
  const statusLabel = String(lead.status || '').replace(/_/g, ' ')
  const amount = money(lead.value)
  const meta = [lead.source, lead.jobType].filter(Boolean).map((s) => String(s).replace(/_/g, ' ')).join(' · ')
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { padding: 12, borderLeftWidth: 3, borderLeftColor: statusHex, borderWidth: 1 }, pressed && styles.cardPressed]}>
      <View style={styles.rowBetween}>
        <Text style={[styles.jobTitle, { fontSize: 14, flex: 1 }]} numberOfLines={1}>{name}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
      </View>
      {lead.company ? <Text style={[styles.meta, { fontSize: 12 }]} numberOfLines={1}>{lead.company}</Text> : null}
      <View style={styles.badgeRow}>
        <View style={[styles.statusBadge, { backgroundColor: tint(statusHex) }]}>
          <Text style={[styles.statusBadgeText, { color: statusHex }]}>{statusLabel}</Text>
        </View>
      </View>
      {lead.jobSiteAddress ? (
        <View style={styles.iconRow}>
          <Ionicons name="location-outline" size={12} color={colors.muted} />
          <Text style={[styles.metaMuted, { fontSize: 11 }]} numberOfLines={1}>{lead.jobSiteAddress}</Text>
        </View>
      ) : null}
      {lead.phone ? (
        <View style={styles.iconRow}>
          <Ionicons name="call-outline" size={12} color={colors.muted} />
          <Text style={[styles.metaMuted, { fontSize: 11, textDecorationLine: 'underline' }]} onPress={() => callPhone(lead.phone)}>
            {lead.phone}
          </Text>
        </View>
      ) : null}
      {amount ? (
        <View style={styles.iconRow}>
          <Ionicons name="cash-outline" size={12} color={colors.textSecondary} />
          <Text style={[styles.amount, { fontSize: 11 }]}>{amount}</Text>
        </View>
      ) : null}
      <View style={styles.iconRow}>
        <Ionicons name="person-outline" size={12} color={colors.muted} />
        <Text style={[styles.metaMuted, { fontSize: 11 }]} numberOfLines={1}>{assignee || 'Unassigned'}</Text>
      </View>
      {meta ? <Text style={[styles.metaFaint, { fontSize: 11 }]} numberOfLines={1}>{meta}</Text> : null}
    </Pressable>
  )
}

type FilterOption = { value: string; label: string }
type FilterOptions = { people: FilterOption[]; clients: FilterOption[]; jobTypes: FilterOption[] }

function activeFilterChips(f: JobFilters, o: FilterOptions): Array<{ key: string; label: string; clear: Partial<JobFilters> }> {
  const chips: Array<{ key: string; label: string; clear: Partial<JobFilters> }> = []
  const find = (list: FilterOption[], v: string) => list.find((x) => x.value === v)?.label || v
  if (f.status !== 'all') chips.push({ key: 'status', label: find(JOB_STATUS_OPTIONS, f.status), clear: { status: 'all' } })
  if (f.assignedTo !== 'all') chips.push({ key: 'assignedTo', label: find(o.people, f.assignedTo), clear: { assignedTo: 'all' } })
  if (f.priority !== 'all') chips.push({ key: 'priority', label: `P${f.priority}`, clear: { priority: 'all' } })
  if (f.due !== 'all') chips.push({ key: 'due', label: DUE_OPTIONS.find((d) => d.value === f.due)?.label || f.due, clear: { due: 'all' } })
  if (f.client !== 'all') chips.push({ key: 'client', label: find(o.clients, f.client), clear: { client: 'all' } })
  if (f.jobType !== 'all') chips.push({ key: 'jobType', label: prettyType(f.jobType), clear: { jobType: 'all' } })
  if (f.sort) chips.push({ key: 'sort', label: `Sort: ${sortLabel(f.sort.key)} ${f.sort.dir === 'asc' ? '↑' : '↓'}`, clear: { sort: null } })
  return chips
}

// Filter + sort sheet for the jobs board. Filters work like the web Production page;
// "Sort by" here is just for you (the Column sorting button changes the company default).
function JobFiltersModal({
  open,
  onClose,
  value,
  onApply,
  options,
  flags,
}: {
  open: boolean
  onClose: () => void
  value: JobFilters
  onApply: (f: JobFilters) => void
  options: FilterOptions
  flags?: ProductionConfig['filters']
}) {
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState<JobFilters>(value)
  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])
  const set = (patch: Partial<JobFilters>) => setDraft((d) => ({ ...d, ...patch }))
  const on = (k: keyof NonNullable<ProductionConfig['filters']>) => flags?.[k] !== false

  const Chips = ({ items, current, onPick }: { items: FilterOption[]; current: string; onPick: (v: string) => void }) => (
    <View style={styles.chipWrap}>
      {items.map((it) => {
        const active = current === it.value
        return (
          <Pressable key={it.value} style={[styles.choiceChip, active && styles.choiceChipActive]} onPress={() => onPick(it.value)}>
            <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]} numberOfLines={1}>{it.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl) }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filter & sort</Text>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={colors.textSecondary} /></Pressable>
          </View>
          <ScrollView style={{ maxHeight: Dimensions.get('window').height * 0.62 }} contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
            <Text style={styles.filterHeading}>Sort by</Text>
            <Chips
              items={[{ value: 'column', label: 'Column default' }, ...SORT_OPTIONS]}
              current={draft.sort?.key || 'column'}
              onPick={(v) => set({ sort: v === 'column' ? null : { key: v as SortKey, dir: draft.sort?.dir || (v === 'lastUpdated' || v === 'priority' ? 'desc' : 'asc') } })}
            />
            {draft.sort ? (
              <View style={styles.sortDirRow}>
                {(['asc', 'desc'] as SortDir[]).map((dir) => (
                  <Pressable
                    key={dir}
                    onPress={() => set({ sort: { key: draft.sort!.key, dir } })}
                    style={[styles.sortDirBtn, draft.sort!.dir === dir && styles.sortDirBtnActive]}
                  >
                    <Ionicons name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} color={draft.sort!.dir === dir ? colors.surface : colors.textSecondary} />
                    <Text style={[styles.sortDirText, draft.sort!.dir === dir && styles.sortDirTextActive]}>{dir === 'asc' ? 'Ascending' : 'Descending'}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {on('status') ? (
              <>
                <Text style={styles.filterHeading}>Status</Text>
                <Chips items={[{ value: 'all', label: 'All Status' }, ...JOB_STATUS_OPTIONS]} current={draft.status} onPick={(v) => set({ status: v })} />
              </>
            ) : null}
            {on('assignedTo') ? (
              <>
                <Text style={styles.filterHeading}>Assigned to</Text>
                <Chips items={[{ value: 'all', label: 'Everyone' }, ...options.people]} current={draft.assignedTo} onPick={(v) => set({ assignedTo: v })} />
              </>
            ) : null}
            {on('priority') ? (
              <>
                <Text style={styles.filterHeading}>Priority</Text>
                <Chips
                  items={[{ value: 'all', label: 'Any Priority' }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `P${n}` }))]}
                  current={draft.priority}
                  onPick={(v) => set({ priority: v })}
                />
              </>
            ) : null}
            {on('dueDate') || on('overdue') ? (
              <>
                <Text style={styles.filterHeading}>Due date</Text>
                <Chips
                  items={DUE_OPTIONS.filter((d) => d.value === 'all' || d.value === 'overdue' || on('dueDate'))}
                  current={draft.due}
                  onPick={(v) => set({ due: v as DueFilter })}
                />
              </>
            ) : null}
            {options.clients.length > 0 ? (
              <>
                <Text style={styles.filterHeading}>Client</Text>
                <Chips items={[{ value: 'all', label: 'All clients' }, ...options.clients]} current={draft.client} onPick={(v) => set({ client: v })} />
              </>
            ) : null}
            {options.jobTypes.length > 0 ? (
              <>
                <Text style={styles.filterHeading}>Job type</Text>
                <Chips items={[{ value: 'all', label: 'All types' }, ...options.jobTypes]} current={draft.jobType} onPick={(v) => set({ jobType: v })} />
              </>
            ) : null}
          </ScrollView>
          <View style={styles.modalFooter}>
            <Pressable onPress={() => setDraft(EMPTY_FILTERS)} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Reset</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onApply(draft)
                onClose()
              }}
              style={styles.modalSave}
            >
              <Text style={styles.modalSaveText}>Show jobs</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// Per-column sorting — the same 8 options the web's Production settings offer.
// Like the web, this is a company-wide setting: people with production.manage can
// change it; everyone else sees how each column is currently sorted.
function SortColumnsModal({
  open,
  onClose,
  columns,
  canManage,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  columns: ColumnConfig[]
  canManage: boolean
  onSaved: () => void
}) {
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState<Record<string, { key: SortKey; dir: SortDir }>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const next: Record<string, { key: SortKey; dir: SortDir }> = {}
    for (const c of columns) next[c.id] = { key: c.defaultSort || 'lastUpdated', dir: c.defaultSortDir || 'desc' }
    setDraft(next)
    setExpanded(null)
    setError(null)
  }, [open, columns])

  const changed = columns.some((c) => {
    const d = draft[c.id]
    return d && (d.key !== (c.defaultSort || 'lastUpdated') || d.dir !== (c.defaultSortDir || 'desc'))
  })

  const setColumnSort = (id: string, patch: Partial<{ key: SortKey; dir: SortDir }>) =>
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      // Re-read the full company config so only the sort fields change.
      const current = await apiRequest<{ config: any }>(`/api/production/settings`)
      const config = current.config
      config.columns = (config.columns || []).map((c: any) =>
        draft[c.id] ? { ...c, defaultSort: draft[c.id].key, defaultSortDir: draft[c.id].dir } : c
      )
      await apiRequest(`/api/production/settings`, 'PUT', { config })
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Could not save the sorting. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl) }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Column sorting</Text>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={colors.textSecondary} /></Pressable>
          </View>
          <Text style={styles.modalSub}>
            {canManage
              ? 'Choose how each column is sorted. This applies to everyone, same as Production settings on the web.'
              : 'How each column is sorted. An admin can change this in Production settings.'}
          </Text>
          <ScrollView style={{ maxHeight: Dimensions.get('window').height * 0.55 }} contentContainerStyle={{ gap: 6, paddingVertical: spacing.xs }}>
            {columns.map((col) => {
              const d = draft[col.id] || { key: 'lastUpdated' as SortKey, dir: 'desc' as SortDir }
              const isOpen = canManage && expanded === col.id
              return (
                <View key={col.id} style={styles.sortCard}>
                  <Pressable
                    style={styles.sortCardHead}
                    disabled={!canManage}
                    onPress={() => setExpanded(isOpen ? null : col.id)}
                  >
                    <View style={[styles.dot, { backgroundColor: col.color }]} />
                    <Text style={styles.modalRowLabel} numberOfLines={1}>{col.displayName}</Text>
                    <Ionicons name={d.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={13} color={colors.textSecondary} />
                    <Text style={styles.sortSummary} numberOfLines={1}>{sortLabel(d.key)}</Text>
                    {canManage ? <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} /> : null}
                  </Pressable>
                  {isOpen ? (
                    <View style={styles.sortOptions}>
                      <View style={styles.sortDirRow}>
                        {(['asc', 'desc'] as SortDir[]).map((dir) => (
                          <Pressable
                            key={dir}
                            onPress={() => setColumnSort(col.id, { dir })}
                            style={[styles.sortDirBtn, d.dir === dir && styles.sortDirBtnActive]}
                          >
                            <Ionicons name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} color={d.dir === dir ? colors.surface : colors.textSecondary} />
                            <Text style={[styles.sortDirText, d.dir === dir && styles.sortDirTextActive]}>{dir === 'asc' ? 'Ascending' : 'Descending'}</Text>
                          </Pressable>
                        ))}
                      </View>
                      {SORT_OPTIONS.map((opt) => {
                        const active = d.key === opt.value
                        return (
                          <Pressable key={opt.value} onPress={() => setColumnSort(col.id, { key: opt.value })} style={styles.sortOptionRow}>
                            <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={18} color={active ? colors.brandPrimary : colors.muted} />
                            <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>{opt.label}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  ) : null}
                </View>
              )
            })}
          </ScrollView>
          {error ? <Text style={styles.sortError}>{error}</Text> : null}
          <View style={styles.modalFooter}>
            <Pressable onPress={onClose} style={styles.modalCancel} disabled={saving}>
              <Text style={styles.modalCancelText}>{canManage ? 'Cancel' : 'Close'}</Text>
            </Pressable>
            {canManage ? (
              <Pressable onPress={save} style={[styles.modalSave, (!changed || saving) && { opacity: 0.5 }]} disabled={!changed || saving}>
                <Text style={styles.modalSaveText}>{saving ? 'Saving…' : 'Save sorting'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  )
}

// Per-user "Customize view": reorder columns and hide/show them. Saves only this
// user's personal view — never the tenant config.
function CustomizeViewModal({
  open,
  onClose,
  title,
  columns,
  pref,
  onSave,
}: {
  open: boolean
  onClose: () => void
  title: string
  columns: BoardColumnDef[]
  pref: BoardViewPref
  onSave: (pref: BoardViewPref) => void | Promise<void>
}) {
  const insets = useSafeAreaInsets()
  const [order, setOrder] = useState<string[]>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const known = columns.map((c) => c.id)
    const ordered = [...(pref.order || []).filter((id) => known.includes(id))]
    for (const id of known) if (!ordered.includes(id)) ordered.push(id)
    setOrder(ordered)
    setHidden(new Set(pref.hidden || []))
  }, [open, columns, pref])

  const byId = new Map(columns.map((c) => [c.id, c]))
  const move = (idx: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }
  const toggleHidden = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ order, hidden: Array.from(hidden) })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl) }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Customize {title}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={colors.textSecondary} /></Pressable>
          </View>
          <Text style={styles.modalSub}>Reorder or hide columns. This changes only your own view.</Text>
          <ScrollView style={{ maxHeight: Dimensions.get('window').height * 0.5 }} contentContainerStyle={{ gap: 6, paddingVertical: spacing.xs }}>
            {order.map((id, idx) => {
              const col = byId.get(id)
              if (!col) return null
              const isHidden = hidden.has(id)
              return (
                <View key={id} style={styles.modalRow}>
                  <View style={[styles.dot, { backgroundColor: col.color }]} />
                  <Text style={[styles.modalRowLabel, isHidden && styles.modalRowLabelHidden]} numberOfLines={1}>{col.label}</Text>
                  <Pressable onPress={() => move(idx, -1)} disabled={idx === 0} hitSlop={6} style={[styles.modalIconBtn, idx === 0 && styles.modalIconBtnDisabled]}>
                    <Ionicons name="chevron-up" size={18} color={colors.textSecondary} />
                  </Pressable>
                  <Pressable onPress={() => move(idx, 1)} disabled={idx === order.length - 1} hitSlop={6} style={[styles.modalIconBtn, idx === order.length - 1 && styles.modalIconBtnDisabled]}>
                    <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
                  </Pressable>
                  <Pressable onPress={() => toggleHidden(id)} hitSlop={6} style={styles.modalIconBtn}>
                    <Ionicons name={isHidden ? 'eye-off-outline' : 'eye-outline'} size={18} color={isHidden ? colors.muted : colors.brandPrimary} />
                  </Pressable>
                </View>
              )
            })}
          </ScrollView>
          <View style={styles.modalFooter}>
            <Pressable onPress={onClose} style={styles.modalCancel} disabled={saving}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
            <Pressable onPress={save} style={styles.modalSave} disabled={saving}><Text style={styles.modalSaveText}>{saving ? 'Saving…' : 'Save my view'}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// Config-driven card — mirrors components/production/ProductionJobCard.tsx (web).
function ProductionCard({ job, config, stageColor, onPress }: { job: ProductionJob; config: ProductionConfig; stageColor?: string; onPress: () => void }) {
  const card = config.card
  const compact = card.density === 'compact'
  const detailed = card.density === 'detailed'
  const pad = compact ? 8 : detailed ? 16 : 12
  const gap = compact ? 2 : detailed ? 8 : 4
  const titleSize = compact ? 12 : detailed ? 15 : 14
  const metaSize = compact ? 11 : 12

  const vis = new Map<string, boolean>()
  for (const f of card.fields) vis.set(f.key, f.visible)
  const show = (key: string, toggle = true) => (vis.get(key) ?? false) && toggle

  const overdue = isOverdue(job.scheduledEnd)
  const address = job.addresses?.[0]?.street
    ? `${job.addresses[0].street}${job.addresses[0].city ? `, ${job.addresses[0].city}` : ''}`
    : null
  const clientName = job.client?.companyName || job.client?.name || null
  const assigned = job.assignments.map((a) => a.user.firstName).filter(Boolean)
  const statusHex = STATUS_HEX[job.status] || '#6b7280'

  const ordered = [...card.fields].sort((a, b) => a.order - b.order)
  const rows: React.ReactNode[] = []
  for (const f of ordered) {
    switch (f.key) {
      case 'jobNumber':
        if (!show('jobNumber')) break
        rows.push(
          <View key="jn" style={styles.rowBetween}>
            <Text style={[styles.jobNumber, card.emphasizeJobNumber ? styles.jobNumberEmph : { fontSize: metaSize }]}>{job.jobNumber}</Text>
            {show('priority') && job.priority >= 4 && (
              <View style={styles.prBadge}><Text style={styles.prBadgeText}>P{job.priority}</Text></View>
            )}
          </View>
        )
        break
      case 'jobName':
        if (!show('jobName') || !job.title) break
        rows.push(<Text key="jnm" style={[styles.jobTitle, { fontSize: titleSize }]} numberOfLines={2}>{job.title}</Text>)
        break
      case 'client':
        if (!show('client') || !clientName) break
        rows.push(<Text key="cl" style={[styles.meta, { fontSize: metaSize }]} numberOfLines={1}>{clientName}</Text>)
        break
      case 'jobSiteAddress':
        if (!show('jobSiteAddress', card.showAddress) || !address) break
        rows.push(
          <View key="ad" style={styles.iconRow}>
            <Ionicons name="location-outline" size={12} color={colors.muted} />
            <Text style={[styles.metaMuted, { fontSize: metaSize }]} numberOfLines={1}>{address}</Text>
          </View>
        )
        break
      case 'jobStatus':
        if (!show('jobStatus', card.showStatusBadge)) break
        rows.push(
          <View key="st" style={styles.badgeRow}>
            <View style={[styles.statusBadge, { backgroundColor: tint(statusHex) }]}>
              <Text style={[styles.statusBadgeText, { color: statusHex }]}>{job.status.replace(/_/g, ' ')}</Text>
            </View>
            {overdue && <View style={styles.overdueBadge}><Text style={styles.overdueText}>Overdue</Text></View>}
          </View>
        )
        break
      case 'productionStage':
        if (!show('productionStage') || !job.production?.stage) break
        rows.push(<Text key="sg" style={[styles.metaMuted, { fontSize: metaSize }]}><Text style={styles.metaLabel}>Stage: </Text>{job.production.stage}</Text>)
        break
      case 'nextAction':
        if (!show('nextAction', card.showNextAction) || !job.production?.nextAction || job.production.nextAction === 'None') break
        rows.push(<Text key="na" style={[styles.metaMuted, { fontSize: metaSize }]} numberOfLines={2}><Text style={styles.metaLabel}>Next: </Text>{job.production.nextAction}</Text>)
        break
      case 'assignedUser':
        if (!show('assignedUser', card.showAssignedUser)) break
        rows.push(
          <View key="as" style={styles.iconRow}>
            <Ionicons name="person-outline" size={12} color={colors.muted} />
            <Text style={[styles.metaMuted, { fontSize: metaSize }]} numberOfLines={1}>{assigned.length ? assigned.join(', ') : 'Unassigned'}</Text>
          </View>
        )
        break
      case 'dueDate':
        if (!show('dueDate', card.showDueDate)) break
        rows.push(
          <View key="dd" style={styles.iconRow}>
            <Ionicons name="calendar-outline" size={12} color={overdue ? colors.danger : colors.muted} />
            <Text style={[{ fontSize: metaSize }, overdue ? styles.overdueMeta : styles.metaMuted]}>Due {fmtDate(job.scheduledEnd)}</Text>
          </View>
        )
        break
      case 'createdDate':
        if (!show('createdDate')) break
        rows.push(
          <View key="cd" style={styles.iconRow}>
            <Ionicons name="time-outline" size={12} color={colors.muted} />
            <Text style={[styles.metaFaint, { fontSize: metaSize }]}>Created {fmtDate(job.createdAt)}</Text>
          </View>
        )
        break
      case 'jobType':
        if (!show('jobType') || !job.jobType) break
        rows.push(<Text key="jt" style={[styles.metaMuted, { fontSize: metaSize }]}>{String(job.jobType).replace(/_/g, ' ')}</Text>)
        break
      case 'estimateAmount': {
        if (!show('estimateAmount')) break
        const m = money(job.estimateAmount)
        if (!m) break
        rows.push(
          <View key="ea" style={styles.iconRow}>
            <Ionicons name="cash-outline" size={12} color={colors.textSecondary} />
            <Text style={[styles.amount, { fontSize: metaSize }]}>{m}</Text>
          </View>
        )
        break
      }
      case 'invoiceAmount':
        if (!show('invoiceAmount') || job.invoiceAmount == null) break
        rows.push(<Text key="ia" style={[styles.meta, { fontSize: metaSize }]}>Invoiced: {money(job.invoiceAmount)}</Text>)
        break
      case 'billingStatus':
        if (!show('billingStatus') || !job.billingStatus) break
        rows.push(<Text key="bs" style={[styles.meta, { fontSize: metaSize }]}>Billing: {job.billingStatus}</Text>)
        break
      case 'purchaseOrder':
        if (!show('purchaseOrder') || !job.poCount) break
        rows.push(
          <View key="po" style={styles.iconRow}>
            <Ionicons name="cube-outline" size={12} color={colors.muted} />
            <Text style={[styles.metaMuted, { fontSize: metaSize }]}>{job.poCount} PO{job.poCount === 1 ? '' : 's'}</Text>
          </View>
        )
        break
    }
  }

  const borderStyle =
    card.borderStyle === 'left-accent' && card.accentFromStageColor && stageColor
      ? { borderLeftWidth: 3, borderLeftColor: stageColor }
      : card.borderStyle === 'full'
        ? { borderWidth: 2 }
        : { borderWidth: 1 }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { padding: pad }, borderStyle, pressed && styles.cardPressed]}>
      <View style={{ gap }}>{rows}</View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tabBarScroll: { flexGrow: 0 },
  tabBar: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  tabItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  tabItemActive: { backgroundColor: '#EFF6FF', borderColor: colors.brandPrimary },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  tabTextActive: { color: colors.brandPrimary },

  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, paddingHorizontal: spacing.md, height: 42 },
  searchInput: { flex: 1, ...typography.sub, color: colors.textPrimary, padding: 0 },
  iconButton: { width: 42, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  iconButtonActive: { backgroundColor: colors.brandPrimary },
  filterBadge: { position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  activeFiltersScroll: { flexGrow: 0, marginTop: spacing.xs },
  activeFilters: { gap: 6, paddingHorizontal: spacing.md, alignItems: 'center' },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 220, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.surface },
  activeChipText: { fontSize: 12, fontWeight: '600', color: colors.brandPrimary, flexShrink: 1 },
  clearChip: { paddingHorizontal: 10, paddingVertical: 5 },
  clearChipText: { fontSize: 12, fontWeight: '700', color: colors.danger },
  filterHeading: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', marginTop: spacing.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choiceChip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.divider, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface, maxWidth: '100%' },
  choiceChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  choiceChipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  choiceChipTextActive: { color: colors.surface },
  archiveButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 42 },
  archiveButtonActive: { backgroundColor: colors.brandPrimary },
  archiveButtonText: { ...typography.caption, color: colors.brandPrimary, fontWeight: '700' },
  archiveButtonTextActive: { color: colors.surface },

  loadingWrap: { padding: spacing.xl, alignItems: 'center' },
  loadingText: { ...typography.sub, color: colors.textSecondary },
  archiveList: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },

  onHoldSection: { marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.lg, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FCD34D', gap: spacing.xs },
  onHoldHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  onHoldTitle: { ...typography.sub, color: '#92400E', fontWeight: '700', flex: 1 },
  onHoldCount: { backgroundColor: '#FDE68A', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  onHoldCountText: { ...typography.caption, color: '#92400E', fontWeight: '700' },

  boardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  boardHeaderText: { ...typography.sub, color: colors.textSecondary, fontWeight: '700' },

  boardWrap: { flex: 1 },
  boardScroll: { flex: 1 },
  onHoldScroll: { maxHeight: Dimensions.get('window').height * 0.22 },
  boardRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md, alignItems: 'stretch' },
  column: { backgroundColor: '#F9FAFB', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.divider, overflow: 'hidden' },
  columnBodyContent: { padding: spacing.xs, gap: spacing.xs },
  columnHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  columnHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  columnTitle: { ...typography.sub, color: '#fff', fontWeight: '700', flexShrink: 1 },
  columnCount: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  columnCountText: { ...typography.caption, color: '#fff', fontWeight: '700' },
  columnBody: { flex: 1 },
  noJobs: { ...typography.caption, color: colors.muted, textAlign: 'center', paddingVertical: spacing.md },

  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderColor: colors.divider, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  cardPressed: { opacity: 0.92 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobNumber: { fontFamily: 'monospace', fontWeight: '700', color: '#374151' },
  jobNumberEmph: { color: '#1d4ed8', fontSize: 14 },
  prBadge: { backgroundColor: '#FEE2E2', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  prBadgeText: { color: '#B91C1C', fontWeight: '700', fontSize: 10 },
  jobTitle: { color: '#111827', fontWeight: '600' },
  meta: { color: '#4B5563' },
  metaMuted: { color: '#6B7280' },
  metaFaint: { color: '#9CA3AF' },
  metaLabel: { color: '#4B5563', fontWeight: '600' },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  statusBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  statusBadgeText: { fontSize: 10, fontWeight: '700' },
  overdueBadge: { backgroundColor: '#FEE2E2', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  overdueText: { color: '#B91C1C', fontSize: 10, fontWeight: '700' },
  overdueMeta: { color: '#DC2626', fontWeight: '600' },
  amount: { color: '#374151', fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xl },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  modalSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  modalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  modalRowLabel: { flex: 1, ...typography.sub, color: colors.textPrimary },
  modalRowLabelHidden: { color: colors.muted, textDecorationLine: 'line-through' },
  sortBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, backgroundColor: colors.surface },
  sortBarText: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  sortCard: { borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md },
  sortCardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 10 },
  sortSummary: { ...typography.caption, color: colors.textSecondary, maxWidth: 110 },
  sortOptions: { borderTopWidth: 1, borderTopColor: colors.divider, padding: spacing.sm, gap: 2 },
  sortDirRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  sortDirBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider },
  sortDirBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  sortDirText: { ...typography.sub, color: colors.textSecondary, fontWeight: '600' },
  sortDirTextActive: { color: colors.surface },
  sortOptionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  sortOptionText: { ...typography.sub, color: colors.textPrimary },
  sortOptionTextActive: { fontWeight: '700', color: colors.brandPrimary },
  sortError: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  modalIconBtn: { padding: 4 },
  modalIconBtnDisabled: { opacity: 0.3 },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  modalCancel: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md },
  modalCancelText: { ...typography.sub, color: colors.textSecondary, fontWeight: '700' },
  modalSave: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  modalSaveText: { ...typography.sub, color: colors.surface, fontWeight: '700' },
})
