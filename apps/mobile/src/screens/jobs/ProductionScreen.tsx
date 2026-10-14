import React, { useCallback, useMemo, useRef, useState } from 'react'
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
  Alert,
} from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { apiRequest } from '../../api/client'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import {
  PRODUCTION_BOARD_COLUMNS,
  getProductionInfo,
  type ProductionBoardColumn,
} from '../../lib/productionBoard'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { JobsStackParamList } from '../../types/navigation'

type Props = NativeStackScreenProps<JobsStackParamList, 'Production'>

interface ProductionJob {
  id: string
  jobNumber: string
  title: string
  status: string
  priority: number
  scheduledStart: string | null
  scheduledEnd: string | null
  estimateAmount: string | null
  actualAmount: string | null
  client: { id: string; name: string; companyName: string | null } | null
  assignments: Array<{ id: string; user: { id: string; firstName: string; lastName: string } }>
  addresses: Array<{ id: string; street: string | null; city: string | null; state: string | null; zipCode: string | null }>
  production: {
    stage: string
    nextAction: string
    board: ProductionBoardColumn
    boardLabel: string
    isActive: boolean
    isOnHold: boolean
    isArchived: boolean
  }
}

interface ProductionColumnConfig {
  id: string
  label?: string
  name?: string
  order: number
  statuses: string[]
}
interface ProductionConfig {
  columns?: ProductionColumnConfig[]
}
interface ProductionResponse {
  jobs: ProductionJob[]
  counts: Record<string, number>
  config?: ProductionConfig
}

interface BoardColumn {
  id: string
  label: string
  statuses: string[] // actual Job.status values that live in this column
}
type BoardColumnWithJobs = BoardColumn & { jobs: ProductionJob[] }

const SCREEN_W = Dimensions.get('window').width

function formatDateShort(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function ProductionScreen({ navigation }: Props) {
  const queryClient = useQueryClient()
  const { canChangeJobStatus } = useMobilePermissions()
  const canMove = canChangeJobStatus()

  const [search, setSearch] = useState('')
  const [archiveView, setArchiveView] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [moveJob, setMoveJob] = useState<ProductionJob | null>(null)
  const pagerRef = useRef<FlatList<BoardColumnWithJobs>>(null)
  const tabsRef = useRef<ScrollView>(null)

  const query = useQuery({
    queryKey: ['production-board', archiveView],
    queryFn: () => apiRequest<ProductionResponse>(`/api/production${archiveView ? '?view=archive' : ''}`),
    refetchInterval: 60_000,
  })

  const jobs = query.data?.jobs ?? []

  // Build the columns from the tenant's web Production Settings config so the
  // mobile board matches the customized web board exactly. Fall back to the
  // default mapping only if the server returns no config.
  const columns: BoardColumn[] = useMemo(() => {
    const cfg = query.data?.config?.columns
    if (cfg && cfg.length) {
      return [...cfg]
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ id: c.id, label: c.label || c.name || c.id, statuses: c.statuses || [] }))
    }
    return PRODUCTION_BOARD_COLUMNS.map((c) => ({ id: c.id, label: c.label, statuses: [] }))
  }, [query.data?.config])

  const usingConfig = Boolean(query.data?.config?.columns?.length)

  const visibleJobs = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return jobs
    return jobs.filter((job) => {
      const address = job.addresses?.[0]
      const haystack = [job.jobNumber, job.title, job.client?.companyName, job.client?.name, address?.street, address?.city]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [jobs, search])

  const onHoldJobs = useMemo(() => visibleJobs.filter((j) => j.production.isOnHold), [visibleJobs])

  const columnIdOfJob = useCallback(
    (job: ProductionJob): string | undefined => {
      if (usingConfig) return columns.find((c) => c.statuses.includes(job.status))?.id
      return job.production.board
    },
    [columns, usingConfig]
  )

  const columnsWithJobs = useMemo(
    () =>
      columns.map((col) => ({
        ...col,
        jobs: visibleJobs.filter((j) => !j.production.isOnHold && columnIdOfJob(j) === col.id),
      })),
    [columns, visibleJobs, columnIdOfJob]
  )

  // ---- Move a job to another column (sets Job.status, optimistic) ----
  const moveMutation = useMutation({
    mutationFn: async ({ jobId, status }: { jobId: string; status: string }) => {
      await apiRequest(`/api/jobs/${jobId}`, 'PUT', { status })
    },
    onMutate: async ({ jobId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['production-board', archiveView] })
      const prev = queryClient.getQueryData<ProductionResponse>(['production-board', archiveView])
      if (prev) {
        queryClient.setQueryData<ProductionResponse>(['production-board', archiveView], {
          ...prev,
          jobs: prev.jobs.map((j) => (j.id === jobId ? { ...j, status } : j)),
        })
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
      return { prev }
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['production-board', archiveView], ctx.prev)
      Alert.alert('Could not move job', err?.message || 'Please try again.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['production-board', archiveView] }),
  })

  const targetStatusForColumn = (col: BoardColumn): string | null => col.statuses[0] || null

  const moveToColumn = (job: ProductionJob, col: BoardColumn) => {
    const status = targetStatusForColumn(col)
    if (!status) {
      Alert.alert('Not available', 'This column has no stage to move to.')
      return
    }
    if (status === job.status) return
    moveMutation.mutate({ jobId: job.id, status })
  }

  const moveRelative = (job: ProductionJob, dir: -1 | 1) => {
    const idx = columns.findIndex((c) => c.id === columnIdOfJob(job))
    const next = columns[idx + dir]
    if (!next) return
    moveToColumn(job, next)
  }

  const goToColumn = (index: number) => {
    setActiveIndex(index)
    pagerRef.current?.scrollToIndex({ index, animated: true })
  }

  const openCard = (job: ProductionJob) => navigation.navigate('AdminJobDetail', { jobId: job.id })

  return (
    <AppScreen padded={false}>
      {/* Controls */}
      <View style={styles.controlsRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search jobs, client, address..."
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <Pressable style={[styles.archiveButton, archiveView && styles.archiveButtonActive]} onPress={() => setArchiveView((v) => !v)}>
          <Ionicons name="archive-outline" size={16} color={archiveView ? colors.surface : colors.brandPrimary} />
          <Text style={[styles.archiveButtonText, archiveView && styles.archiveButtonTextActive]}>{archiveView ? 'Board' : 'Archive'}</Text>
        </Pressable>
      </View>

      {query.isLoading ? (
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading production board...</Text>
        </View>
      ) : archiveView ? (
        <ScrollView
          contentContainerStyle={styles.archiveList}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        >
          {visibleJobs.length === 0 ? (
            <EmptyState icon="archive-outline" title="Nothing here" description="No completed, cancelled, or invoiced jobs match these filters." />
          ) : (
            visibleJobs.map((job) => <ProductionCard key={job.id} job={job} canMove={false} onPress={() => openCard(job)} onAdvance={() => {}} onBack={() => {}} onMove={() => {}} />)
          )}
        </ScrollView>
      ) : (
        <>
          {/* On Hold banner (tap to jump) */}
          {onHoldJobs.length > 0 && (
            <Pressable style={styles.onHoldBar} onPress={() => setMoveJob(null)}>
              <Ionicons name="warning-outline" size={15} color="#C2410C" />
              <Text style={styles.onHoldBarText}>{onHoldJobs.length} on hold / need attention</Text>
            </Pressable>
          )}

          {/* Column tabs (swipe or tap to switch — no horizontal board scrollbar) */}
          <ScrollView ref={tabsRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
            {columnsWithJobs.map((col, i) => (
              <Pressable key={col.id} onPress={() => goToColumn(i)} style={[styles.tab, i === activeIndex && styles.tabActive]}>
                <Text style={[styles.tabText, i === activeIndex && styles.tabTextActive]} numberOfLines={1}>
                  {col.label}
                </Text>
                <View style={[styles.tabCount, i === activeIndex && styles.tabCountActive]}>
                  <Text style={[styles.tabCountText, i === activeIndex && styles.tabCountTextActive]}>{col.jobs.length}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>

          {/* Swipeable full-width column pages */}
          <FlatList
            ref={pagerRef}
            data={columnsWithJobs}
            keyExtractor={(c) => c.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W)
              setActiveIndex(idx)
              tabsRef.current?.scrollTo({ x: Math.max(0, idx * 96 - 96), animated: true })
            }}
            getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
            renderItem={({ item: col }) => (
              <View style={{ width: SCREEN_W }}>
                <FlatList
                  data={col.jobs}
                  keyExtractor={(j) => j.id}
                  contentContainerStyle={styles.columnList}
                  refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
                  ListEmptyComponent={<Text style={styles.noJobs}>No jobs in {col.label}</Text>}
                  renderItem={({ item: job }) => (
                    <ProductionCard
                      job={job}
                      canMove={canMove && usingConfig}
                      onPress={() => openCard(job)}
                      onAdvance={() => moveRelative(job, 1)}
                      onBack={() => moveRelative(job, -1)}
                      onMove={() => setMoveJob(job)}
                    />
                  )}
                />
              </View>
            )}
          />
        </>
      )}

      {/* Move sheet: pick any column */}
      <Modal visible={!!moveJob} transparent animationType="slide" onRequestClose={() => setMoveJob(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMoveJob(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Move {moveJob?.jobNumber} to…</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {columns.map((col) => {
                const isCurrent = moveJob ? columnIdOfJob(moveJob) === col.id : false
                return (
                  <Pressable
                    key={col.id}
                    style={[styles.sheetRow, isCurrent && styles.sheetRowCurrent]}
                    disabled={isCurrent || !targetStatusForColumn(col)}
                    onPress={() => {
                      if (moveJob) moveToColumn(moveJob, col)
                      setMoveJob(null)
                    }}
                  >
                    <Text style={[styles.sheetRowText, isCurrent && styles.sheetRowTextCurrent]}>{col.label}</Text>
                    {isCurrent && <Ionicons name="checkmark" size={18} color={colors.brandPrimary} />}
                  </Pressable>
                )
              })}
            </ScrollView>
            <Pressable style={styles.sheetCancel} onPress={() => setMoveJob(null)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </AppScreen>
  )
}

function ProductionCard({
  job,
  canMove,
  onPress,
  onAdvance,
  onBack,
  onMove,
}: {
  job: ProductionJob
  canMove: boolean
  onPress: () => void
  onAdvance: () => void
  onBack: () => void
  onMove: () => void
}) {
  const address = job.addresses?.[0]
  const clientName = job.client?.companyName || job.client?.name
  const crewNames = job.assignments.map((a) => a.user.firstName).filter(Boolean)
  const dueLabel = formatDateShort(job.scheduledEnd)
  const isHighPriority = Number(job.priority) >= 4
  const amount = job.estimateAmount || job.actualAmount
  const info = getProductionInfo(job.status)

  const card = (
    <Pressable
      onPress={onPress}
      onLongPress={canMove ? onMove : undefined}
      delayLongPress={250}
      style={({ pressed }) => [styles.jobCard, pressed && styles.jobCardPressed]}
    >
      <View style={styles.jobCardTop}>
        <Text style={styles.jobNumber}>{job.jobNumber}</Text>
        {isHighPriority && (
          <View style={styles.priorityBadge}>
            <Text style={styles.priorityBadgeText}>P{job.priority}</Text>
          </View>
        )}
      </View>
      {job.title ? <Text style={styles.jobTitle} numberOfLines={1}>{job.title}</Text> : null}
      {address?.street ? (
        <Text style={styles.jobMeta} numberOfLines={1}>
          {address.street}
          {address.city ? `, ${address.city}` : ''}
        </Text>
      ) : null}
      {clientName ? <Text style={styles.jobClient} numberOfLines={1}>{clientName}</Text> : null}
      <View style={styles.jobDivider} />
      <Text style={styles.jobStage} numberOfLines={1}>Stage: {info.stage}</Text>
      <Text style={styles.jobNextAction} numberOfLines={2}>Next: {info.nextAction}</Text>
      <View style={styles.jobDivider} />
      <View style={styles.jobFooterRow}>
        <Text style={styles.jobFooterText} numberOfLines={1}>{crewNames.length ? crewNames.join(', ') : 'Unassigned'}</Text>
        {dueLabel ? <Text style={styles.jobFooterText}>{dueLabel}</Text> : null}
      </View>
      {amount ? <Text style={styles.jobAmount}>${Number(amount).toFixed(2)}</Text> : null}
      {canMove ? <Text style={styles.jobHint}>Long-press to move · swipe to advance</Text> : null}
    </Pressable>
  )

  if (!canMove) return card

  return (
    <Swipeable
      renderLeftActions={() => (
        <View style={[styles.swipeAction, styles.swipeBack]}>
          <Ionicons name="arrow-back" size={18} color="#fff" />
          <Text style={styles.swipeActionText}>Back</Text>
        </View>
      )}
      renderRightActions={() => (
        <View style={[styles.swipeAction, styles.swipeAdvance]}>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
          <Text style={styles.swipeActionText}>Advance</Text>
        </View>
      )}
      onSwipeableOpen={(dir) => {
        if (dir === 'right') onAdvance()
        else onBack()
      }}
      friction={2}
      rightThreshold={60}
      leftThreshold={60}
    >
      {card}
    </Swipeable>
  )
}

const styles = StyleSheet.create({
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  searchInput: { flex: 1, ...typography.sub, color: colors.textPrimary, padding: 0 },
  archiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  archiveButtonActive: { backgroundColor: colors.brandPrimary },
  archiveButtonText: { ...typography.caption, color: colors.brandPrimary, fontWeight: '700' },
  archiveButtonTextActive: { color: colors.surface },

  loadingWrap: { padding: spacing.xl, alignItems: 'center' },
  loadingText: { ...typography.sub, color: colors.textSecondary },

  archiveList: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },

  onHoldBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(249,115,22,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.3)',
  },
  onHoldBarText: { ...typography.caption, color: '#C2410C', fontWeight: '700' },

  tabsRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    marginRight: spacing.xs,
  },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', maxWidth: 140 },
  tabTextActive: { color: '#E6C98B' },
  tabCount: { backgroundColor: colors.divider, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  tabCountActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  tabCountText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  tabCountTextActive: { color: '#fff' },

  columnList: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs },
  noJobs: { ...typography.caption, color: colors.muted, textAlign: 'center', padding: spacing.xl },

  jobCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, marginVertical: spacing.xs, borderWidth: 1, borderColor: colors.divider },
  jobCardPressed: { opacity: 0.9 },
  jobCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobNumber: { ...typography.sub, color: colors.brandPrimary, fontWeight: '700' },
  priorityBadge: { backgroundColor: 'rgba(220,38,38,0.12)', borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  priorityBadgeText: { ...typography.caption, color: colors.danger, fontWeight: '700' },
  jobTitle: { ...typography.caption, color: colors.textPrimary, fontWeight: '600', marginTop: 2 },
  jobMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  jobClient: { ...typography.caption, color: colors.muted, marginTop: 1 },
  jobDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.xs },
  jobStage: { ...typography.caption, color: colors.textSecondary },
  jobNextAction: { ...typography.caption, color: colors.textPrimary, fontWeight: '600', marginTop: 2 },
  jobFooterRow: { flexDirection: 'row', justifyContent: 'space-between' },
  jobFooterText: { ...typography.caption, color: colors.muted, fontSize: 11 },
  jobAmount: { ...typography.caption, color: colors.textSecondary, fontWeight: '600', marginTop: 4 },
  jobHint: { ...typography.caption, color: colors.muted, fontSize: 10, marginTop: 4, fontStyle: 'italic' },

  swipeAction: { justifyContent: 'center', alignItems: 'center', width: 92, marginVertical: spacing.xs, borderRadius: radius.md },
  swipeAdvance: { backgroundColor: '#16A34A' },
  swipeBack: { backgroundColor: '#6B7280' },
  swipeActionText: { ...typography.caption, color: '#fff', fontWeight: '700', marginTop: 2 },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, paddingBottom: spacing.xl },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.divider, marginBottom: spacing.sm },
  sheetTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  sheetRowCurrent: { backgroundColor: 'rgba(0,0,0,0.04)' },
  sheetRowText: { ...typography.sub, color: colors.textPrimary },
  sheetRowTextCurrent: { color: colors.brandPrimary, fontWeight: '700' },
  sheetCancel: { marginTop: spacing.sm, alignItems: 'center', paddingVertical: spacing.sm },
  sheetCancelText: { ...typography.sub, color: colors.textSecondary, fontWeight: '700' },
})
