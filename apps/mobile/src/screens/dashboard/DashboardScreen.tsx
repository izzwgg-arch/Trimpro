import React, { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { Attachment, Conversation, Issue, Job, Task } from '../../types/models'
import { SyncBanner } from '../../components/SyncBanner'
import { useOnlineState } from '../../hooks/useOnlineState'
import { useOutboxCount } from '../../hooks/useOutboxCount'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { EmptyState } from '../../components/EmptyState'
import { JobCard } from '../../components/JobCard'
import { SectionHeader } from '../../components/SectionHeader'
import { Card } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import { useAuth } from '../../auth/AuthContext'
import { DashboardStackParamList } from '../../types/navigation'

type Props = NativeStackScreenProps<DashboardStackParamList, 'DashboardHome'>

interface JobsResponse {
  jobs: Job[]
}

interface AssignmentsResponse {
  jobs: Array<Pick<Job, 'id' | 'jobNumber' | 'title' | 'status' | 'priority'> & { updatedAt: string }>
  tasks: Array<Pick<Task, 'id' | 'title' | 'status' | 'priority'> & { dueDate?: string | null; updatedAt: string }>
  issues: Array<Pick<Issue, 'id' | 'title' | 'status' | 'priority' | 'type' | 'jobId'> & { updatedAt: string }>
  serverTime: string
}

interface ConversationsResponse {
  conversations: Conversation[]
}

export function DashboardScreen({ navigation }: Props) {
  const { user } = useAuth()
  const isOnline = useOnlineState()
  const outboxCount = useOutboxCount()
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)
  const todayKey = useMemo(() => new Date().toDateString(), [])

  const jobsQuery = useQuery({
    queryKey: ['mobile-jobs-dashboard'],
    queryFn: async () => {
      const data = await apiRequest<JobsResponse>('/api/mobile/jobs?limit=100')
      setLastSyncAt(new Date())
      return data
    },
    refetchInterval: 60_000,
  })

  const assignmentsQuery = useQuery({
    queryKey: ['mobile-assignments'],
    queryFn: async () => {
      const data = await apiRequest<AssignmentsResponse>('/api/mobile/assignments')
      setLastSyncAt(new Date())
      return data
    },
    refetchInterval: 45_000,
  })

  const conversationsQuery = useQuery({
    queryKey: ['mobile-conversations'],
    queryFn: () => apiRequest<ConversationsResponse>('/api/messages/conversations?assigned=me'),
    refetchInterval: 45_000,
  })

  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data])
  const taskNotifications = useMemo(() => assignmentsQuery.data?.tasks ?? [], [assignmentsQuery.data])
  const issueNotifications = useMemo(() => assignmentsQuery.data?.issues ?? [], [assignmentsQuery.data])

  const todaysJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (!job.scheduledStart) return false
        return new Date(job.scheduledStart).toDateString() === todayKey
      }),
    [jobs, todayKey]
  )

  const todayJobIds = useMemo(() => new Set(todaysJobs.map((j) => j.id)), [todaysJobs])

  const todaysTasks = useMemo(
    () =>
      taskNotifications.filter((task) => {
        if (String(task.status).toUpperCase() === 'COMPLETED') return false
        if (!task.dueDate) return false
        return new Date(task.dueDate).toDateString() === todayKey
      }),
    [taskNotifications, todayKey]
  )

  const openIssues = useMemo(
    () =>
      issueNotifications.filter((issue) => {
        const status = String(issue.status || '').toUpperCase()
        if (['RESOLVED', 'CLOSED', 'CANCELLED'].includes(status)) return false
        return !issue.jobId || todayJobIds.has(issue.jobId)
      }),
    [issueNotifications, todayJobIds]
  )

  const unreadMessagesByJob = useMemo(() => {
    const map = new Map<string, number>()
    const rows = conversationsQuery.data?.conversations ?? []
    for (const row of rows) {
      const jobId = (row as any).jobId as string | undefined
      if (!jobId) continue
      map.set(jobId, Number(row.unreadCount || 0))
    }
    return map
  }, [conversationsQuery.data?.conversations])

  const todayMediaQuery = useQuery({
    queryKey: ['mobile-job-media-today', todaysJobs.map((j) => j.id).join(',')],
    enabled: todaysJobs.length > 0,
    queryFn: async () => {
      const out = new Map<string, number>()
      await Promise.all(
        todaysJobs.slice(0, 20).map(async (job) => {
          const data = await apiRequest<{ attachments: Attachment[] }>(`/api/attachments?entityType=job&entityId=${job.id}`)
          const hasRecent = (data.attachments || []).some((a) => Date.now() - new Date(a.createdAt).getTime() < 24 * 60 * 60 * 1000)
          out.set(job.id, hasRecent ? 1 : 0)
        })
      )
      return out
    },
    refetchInterval: 60_000,
  })

  const navigateToJobs = () => {
    const parent: any = navigation.getParent()
    parent?.navigate('JobsTab')
  }

  const navigateToTasks = () => {
    const parent: any = navigation.getParent()
    parent?.navigate('TasksTab')
  }

  const navigateToIssues = () => {
    const parent: any = navigation.getParent()
    parent?.navigate('IssuesTab')
  }

  const openTask = (taskId: string) => {
    const parent: any = navigation.getParent()
    parent?.navigate('TasksTab', { screen: 'TaskDetail', params: { taskId } })
  }

  const openIssue = (issueId: string) => {
    const parent: any = navigation.getParent()
    parent?.navigate('IssuesTab', { screen: 'IssueDetail', params: { issueId } })
  }

  const onRefreshAll = async () => {
    await Promise.all([jobsQuery.refetch(), assignmentsQuery.refetch(), conversationsQuery.refetch()])
  }

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    []
  )

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }, [])

  const lastSyncText = useMemo(() => {
    if (!lastSyncAt) return 'Not synced yet'
    const mins = Math.max(0, Math.floor((Date.now() - lastSyncAt.getTime()) / 60000))
    if (mins < 1) return 'Synced just now'
    if (mins < 60) return `Synced ${mins}m ago`
    const hrs = Math.floor(mins / 60)
    return `Synced ${hrs}h ago`
  }, [lastSyncAt])

  const renderTaskItem = (task: AssignmentsResponse['tasks'][number]) => (
    <Pressable key={task.id} style={({ pressed }) => [styles.rowPressable, pressed && styles.rowPressed]} onPress={() => openTask(task.id)}>
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {task.title}
        </Text>
        <Text style={styles.rowMeta}>Due {task.dueDate ? new Date(task.dueDate).toLocaleString() : 'No date'}</Text>
      </View>
      <StatusBadge status={task.status} />
    </Pressable>
  )

  const renderIssueItem = (issue: AssignmentsResponse['issues'][number]) => (
    <Pressable key={issue.id} style={({ pressed }) => [styles.rowPressable, pressed && styles.rowPressed]} onPress={() => openIssue(issue.id)}>
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {issue.title}
        </Text>
        <Text style={styles.rowMeta}>
          {issue.type ? `${issue.type} • ` : ''}Updated {new Date(issue.updatedAt).toLocaleString()}
        </Text>
      </View>
      <StatusBadge status={issue.status} />
    </Pressable>
  )

  return (
    <AppScreen>
      <FlatList
        data={[]}
        keyExtractor={() => 'dashboard'}
        refreshControl={
          <RefreshControl
            refreshing={jobsQuery.isRefetching || assignmentsQuery.isRefetching || conversationsQuery.isRefetching}
            onRefresh={() => void onRefreshAll()}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Card style={styles.hero}>
              <Text style={styles.heroGreeting}>
                {greeting}, {user?.firstName || 'Crew'}
              </Text>
              <Text style={styles.heroDate}>{todayLabel}</Text>
              <View style={styles.heroChips}>
                <View style={[styles.chip, { backgroundColor: isOnline ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)' }]}>
                  <View style={[styles.dot, { backgroundColor: isOnline ? colors.success : colors.danger }]} />
                  <Text style={[styles.chipText, { color: isOnline ? '#15803D' : '#B91C1C' }]}>{isOnline ? 'Online' : 'Offline'}</Text>
                </View>
                <View style={styles.chip}>
                  <Ionicons name="cloud-done-outline" size={12} color={colors.textSecondary} />
                  <Text style={styles.chipText}>{lastSyncText}</Text>
                </View>
              </View>
              <View style={styles.glanceRow}>
                <GlanceStat label="Jobs Today" value={todaysJobs.length} />
                <GlanceStat label="Tasks Due" value={todaysTasks.length} />
                <GlanceStat label="Open Issues" value={openIssues.length} />
              </View>
            </Card>

            <SyncBanner
              isOnline={isOnline}
              isSyncing={jobsQuery.isFetching || assignmentsQuery.isFetching || conversationsQuery.isFetching}
              lastSyncAt={lastSyncAt}
              outboxCount={outboxCount}
            />

            <Card>
              <SectionHeader title="Today's Jobs" rightActionLabel="See all" onRightAction={navigateToJobs} />
              {todaysJobs.length === 0 ? (
                <EmptyState icon="briefcase-outline" title="No jobs for today" description="New assignments will appear here." />
              ) : (
                todaysJobs.slice(0, 5).map((job) => (
                  <View key={job.id} style={styles.stackItem}>
                    <JobCard
                      job={job}
                      onPress={() => {
                        const parent: any = navigation.getParent()
                        parent?.navigate('JobsTab', { screen: 'JobDetail', params: { jobId: job.id } })
                      }}
                      hasUnreadMessages={(unreadMessagesByJob.get(job.id) || 0) > 0}
                      hasNewMedia={(todayMediaQuery.data?.get(job.id) || 0) > 0}
                      hasOpenIssue={openIssues.some((x) => x.jobId === job.id)}
                    />
                  </View>
                ))
              )}
            </Card>

            <Card>
              <SectionHeader title="Today's Tasks" rightActionLabel="See all" onRightAction={navigateToTasks} />
              {todaysTasks.length === 0 ? (
                <EmptyState icon="checkbox-outline" title="No tasks due today" description="You are all caught up." />
              ) : (
                todaysTasks.slice(0, 5).map(renderTaskItem)
              )}
            </Card>

            <Card>
              <SectionHeader title="Open Issues" rightActionLabel="See all" onRightAction={navigateToIssues} />
              {openIssues.length === 0 ? (
                <EmptyState icon="alert-circle-outline" title="No open issues" description="Issue queue is clear." />
              ) : (
                openIssues.slice(0, 5).map(renderIssueItem)
              )}
            </Card>
          </View>
        }
      />
    </AppScreen>
  )
}

function GlanceStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.glanceItem}>
      <Text style={styles.glanceValue}>{value}</Text>
      <Text style={styles.glanceLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  listHeader: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.md },
  hero: {
    backgroundColor: '#EEF3F6',
    borderColor: '#DCE6EC',
    borderRadius: radius.lg,
  },
  heroGreeting: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  heroDate: {
    ...typography.sub,
    color: colors.textSecondary,
    marginTop: 2,
  },
  heroChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chip: {
    minHeight: 30,
    borderRadius: radius.pill,
    backgroundColor: '#E9EFF4',
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  glanceRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  glanceItem: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  glanceValue: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  glanceLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  rowPressable: {
    minHeight: 54,
    borderTopWidth: 1,
    borderColor: colors.divider,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowPressed: {
    opacity: 0.88,
  },
  rowTextWrap: { flex: 1 },
  rowTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '700' },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  stackItem: { marginBottom: spacing.sm },
})
