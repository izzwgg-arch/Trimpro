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
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { EmptyState } from '../../components/EmptyState'
import { apiRequest } from '../../api/client'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { JobsStackParamList } from '../../types/navigation'

type Props = NativeStackScreenProps<JobsStackParamList, 'Production'>

type BoardKey = 'jobs' | 'tasks' | 'leads'

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
interface ColumnConfig {
  id: string
  displayName: string
  color: string
  icon: string
  order: number
  visible: boolean
  showJobCount: boolean
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
  job?: { jobNumber?: string | null } | null
}
interface LeadItem {
  id: string
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  phone?: string | null
  status: string
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

  const [tab, setTab] = useState<BoardKey>('jobs')
  const [search, setSearch] = useState('')
  const [archiveView, setArchiveView] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)

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

  const jobs = query.data?.jobs ?? []
  const config = query.data?.config

  const visibleJobs = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return jobs
    return jobs.filter((job) => {
      const a = job.addresses?.[0]
      return [job.jobNumber, job.title, job.client?.companyName, job.client?.name, a?.street, a?.city]
        .filter(Boolean).join(' ').toLowerCase().includes(term)
    })
  }, [jobs, search])

  const columns = useMemo(() => {
    const cols = (config?.columns || []).filter((c) => c.visible).sort((a, b) => a.order - b.order)
    const withJobs = cols.map((col) => ({
      id: col.id,
      col,
      jobs: visibleJobs.filter((j) => j.status !== 'ON_HOLD' && col.statuses.includes(j.status)),
    }))
    return applyBoardPref(withJobs, prefs.jobs) // user's personal order/hidden
  }, [config, visibleJobs, prefs.jobs])

  const onHoldStage = config?.stages?.find((s) => s.status === 'ON_HOLD')
  const onHoldJobs = useMemo(() => visibleJobs.filter((j) => j.status === 'ON_HOLD'), [visibleJobs])

  // ---- tasks grouped into columns ----
  const tasks = tasksQuery.data?.tasks ?? []
  const taskColumns = useMemo(() => applyBoardPref(TASK_BOARD_COLUMNS, prefs.tasks), [prefs.tasks])
  const tasksByCol = useMemo(() => {
    const m: Record<string, TaskItem[]> = {}
    for (const c of TASK_BOARD_COLUMNS) m[c.id] = []
    for (const t of tasks) { const s = String(t.status || '').toUpperCase(); (m[s] = m[s] || []).push(t) }
    return m
  }, [tasks])

  // ---- leads grouped into columns ----
  const leads = leadsQuery.data?.leads ?? []
  const leadColumns = useMemo(() => applyBoardPref(LEAD_BOARD_COLUMNS, prefs.leads), [prefs.leads])
  const leadsByCol = useMemo(() => {
    const m: Record<string, LeadItem[]> = {}
    for (const c of LEAD_BOARD_COLUMNS) m[c.id] = []
    for (const l of leads) { const s = String(l.status || '').toUpperCase(); (m[s] = m[s] || []).push(l) }
    return m
  }, [leads])

  // What the Customize modal edits for the active tab.
  const customizeCols: BoardColumnDef[] =
    tab === 'jobs'
      ? (config?.columns || []).filter((c) => c.visible).sort((a, b) => a.order - b.order).map((c) => ({ id: c.id, label: c.displayName, color: c.color, icon: c.icon }))
      : tab === 'tasks'
        ? TASK_BOARD_COLUMNS
        : LEAD_BOARD_COLUMNS
  const customizePref: BoardViewPref = prefs[tab] || { order: [], hidden: [] }

  const colWidth = config ? Math.min(config.card.width, SCREEN_W * 0.86) : SCREEN_W * 0.86
  const openJob = (id: string) => navigation.navigate('AdminJobDetail', { jobId: id })
  const openRequest = (id: string) => navigation.navigate('RequestDetail', { requestId: id })

  const tabs: Array<{ key: BoardKey; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
    { key: 'jobs', label: 'Production', icon: 'construct-outline' },
    ...(canViewTasks ? [{ key: 'tasks' as BoardKey, label: 'Tasks', icon: 'checkbox-outline' as keyof typeof Ionicons.glyphMap }] : []),
    ...(canViewLeads ? [{ key: 'leads' as BoardKey, label: 'Requests', icon: 'megaphone-outline' as keyof typeof Ionicons.glyphMap }] : []),
  ]

  return (
    <AppScreen padded={false}>
      {/* Tab bar: Production | Tasks | Requests */}
      <View style={styles.tabBar}>
        {tabs.map((t) => {
          const active = tab === t.key
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tabItem, active && styles.tabItemActive]}>
              <Ionicons name={t.icon} size={15} color={active ? colors.brandPrimary : colors.textSecondary} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          )
        })}
      </View>

      {/* Controls (search + customize, and archive on the jobs tab) */}
      <View style={styles.controlsRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder={tab === 'jobs' ? 'Search jobs…' : tab === 'tasks' ? 'Search tasks…' : 'Search requests…'}
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <Pressable style={styles.iconButton} onPress={() => setCustomizeOpen(true)} hitSlop={8}>
          <Ionicons name="options-outline" size={18} color={colors.brandPrimary} />
        </Pressable>
        {tab === 'jobs' && (
          <Pressable style={[styles.archiveButton, archiveView && styles.archiveButtonActive]} onPress={() => setArchiveView((v) => !v)}>
            <Ionicons name="archive-outline" size={16} color={archiveView ? colors.surface : colors.brandPrimary} />
            <Text style={[styles.archiveButtonText, archiveView && styles.archiveButtonTextActive]}>{archiveView ? 'Board' : 'Archive'}</Text>
          </Pressable>
        )}
      </View>

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
              renderItem={({ item }) => <TaskCard task={item} />}
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

      <CustomizeViewModal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        title={tab === 'jobs' ? 'Production' : tab === 'tasks' ? 'Tasks' : 'Requests'}
        columns={customizeCols}
        pref={customizePref}
        onSave={(p) => saveViewPref(tab, p)}
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

function TaskCard({ task }: { task: TaskItem }) {
  const assignee = task.assignee ? `${task.assignee.firstName || ''} ${task.assignee.lastName || ''}`.trim() : ''
  const overdue = isOverdue(task.dueDate)
  return (
    <View style={[styles.card, { padding: 12, borderWidth: 1 }]}>
      <Text style={[styles.jobTitle, { fontSize: 14 }]} numberOfLines={2}>{task.title}</Text>
      <View style={styles.badgeRow}>
        {task.priority != null && String(task.priority) !== '' && (
          <View style={styles.prBadge}><Text style={styles.prBadgeText}>{String(task.priority)}</Text></View>
        )}
        <Text style={[styles.metaMuted, { fontSize: 11 }]} numberOfLines={1}>{assignee || 'Unassigned'}</Text>
      </View>
      {task.dueDate ? (
        <View style={styles.iconRow}>
          <Ionicons name="calendar-outline" size={12} color={overdue ? colors.danger : colors.muted} />
          <Text style={[{ fontSize: 11 }, overdue ? styles.overdueMeta : styles.metaMuted]}>Due {fmtDate(task.dueDate)}</Text>
        </View>
      ) : null}
      {task.job?.jobNumber ? <Text style={[styles.metaFaint, { fontSize: 11 }]}>Job {task.job.jobNumber}</Text> : null}
    </View>
  )
}

function LeadCard({ lead, onPress }: { lead: LeadItem; onPress: () => void }) {
  const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.company || 'Request'
  const assignee = lead.assignedTo ? `${lead.assignedTo.firstName || ''} ${lead.assignedTo.lastName || ''}`.trim() : ''
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { padding: 12, borderWidth: 1 }, pressed && styles.cardPressed]}>
      <Text style={[styles.jobTitle, { fontSize: 14 }]} numberOfLines={1}>{name}</Text>
      {lead.company ? <Text style={[styles.metaMuted, { fontSize: 11 }]} numberOfLines={1}>{lead.company}</Text> : null}
      <View style={styles.badgeRow}>
        {lead.phone ? <Text style={[styles.metaMuted, { fontSize: 11 }]}>{lead.phone}</Text> : null}
        {assignee ? <Text style={[styles.metaMuted, { fontSize: 11 }]} numberOfLines={1}>· {assignee}</Text> : null}
      </View>
    </Pressable>
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
        <View style={styles.modalCard}>
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
  tabBar: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  tabItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  tabItemActive: { backgroundColor: '#EFF6FF', borderColor: colors.brandPrimary },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  tabTextActive: { color: colors.brandPrimary },

  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, paddingHorizontal: spacing.md, height: 42 },
  searchInput: { flex: 1, ...typography.sub, color: colors.textPrimary, padding: 0 },
  iconButton: { width: 42, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
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
  modalIconBtn: { padding: 4 },
  modalIconBtnDisabled: { opacity: 0.3 },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  modalCancel: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md },
  modalCancelText: { ...typography.sub, color: colors.textSecondary, fontWeight: '700' },
  modalSave: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  modalSaveText: { ...typography.sub, color: colors.surface, fontWeight: '700' },
})
