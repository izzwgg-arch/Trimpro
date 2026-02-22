import React, { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Ionicons } from '@expo/vector-icons'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { Attachment, Conversation, Issue, Job, Task } from '../../types/models'
import { StatusChip } from '../../components/StatusChip'
import { SyncBanner } from '../../components/SyncBanner'
import { useOnlineState } from '../../hooks/useOnlineState'
import { useOutboxCount } from '../../hooks/useOutboxCount'
import { BRAND } from '../../config/env'
import { JobsStackParamList } from '../../types/navigation'

type Props = NativeStackScreenProps<JobsStackParamList, 'JobsList'>

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

export function JobsScreen({ navigation }: Props) {
  const isOnline = useOnlineState()
  const outboxCount = useOutboxCount()
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)
  const todayKey = useMemo(() => new Date().toDateString(), [])

  const jobsQuery = useQuery({
    queryKey: ['mobile-jobs'],
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

  const navigateToTasks = () => {
    const parent: any = navigation.getParent()
    parent?.navigate('TasksTab')
  }

  const navigateToIssues = () => {
    const parent: any = navigation.getParent()
    parent?.navigate('MoreTab', { screen: 'Issues' })
  }

  const openTask = (taskId: string) => {
    const parent: any = navigation.getParent()
    parent?.navigate('TasksTab', { screen: 'TaskDetail', params: { taskId } })
  }

  const openIssue = (issueId: string) => {
    const parent: any = navigation.getParent()
    parent?.navigate('MoreTab', { screen: 'IssueDetail', params: { issueId } })
  }

  const onRefreshAll = async () => {
    await Promise.all([jobsQuery.refetch(), assignmentsQuery.refetch(), conversationsQuery.refetch()])
  }

  return (
    <Screen style={styles.screen}>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={jobsQuery.isRefetching || assignmentsQuery.isRefetching || conversationsQuery.isRefetching}
            onRefresh={() => void onRefreshAll()}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.header}>Dashboard</Text>
            <SyncBanner
              isOnline={isOnline}
              isSyncing={jobsQuery.isFetching || assignmentsQuery.isFetching || conversationsQuery.isFetching}
              lastSyncAt={lastSyncAt}
              outboxCount={outboxCount}
            />

            <SectionCard title="Today's Jobs" onSeeAll={() => {}}>
              {todaysJobs.length === 0 ? (
                <Text style={styles.sectionEmpty}>No jobs assigned for today.</Text>
              ) : (
                todaysJobs.slice(0, 5).map((job) => (
                  <Pressable key={job.id} style={styles.todayJobCard} onPress={() => navigation.navigate('JobDetail', { jobId: job.id })}>
                    <View style={styles.notificationTitleRow}>
                      <Text style={styles.notificationTitle} numberOfLines={1}>
                        {job.jobNumber} - {job.title}
                      </Text>
                      <StatusChip status={job.status} />
                    </View>
                    <Text style={styles.notificationMeta}>
                      {job.client?.name || 'No client'} • {job.scheduledStart ? new Date(job.scheduledStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No time'}
                    </Text>
                    <Text style={styles.notificationMeta} numberOfLines={1}>
                      {job.address?.street ? `${job.address.street}, ${job.address.city || ''} ${job.address.state || ''}` : 'No job site address'}
                    </Text>
                    <View style={styles.iconRow}>
                      <Ionicons name="chatbubble-ellipses-outline" size={14} color={(unreadMessagesByJob.get(job.id) || 0) > 0 ? BRAND.primary : '#98A2B3'} />
                      <Ionicons name="images-outline" size={14} color={(todayMediaQuery.data?.get(job.id) || 0) > 0 ? BRAND.primary : '#98A2B3'} />
                      <Ionicons name="alert-circle-outline" size={14} color={openIssues.some((x) => x.jobId === job.id) ? '#B42318' : '#98A2B3'} />
                    </View>
                  </Pressable>
                ))
              )}
            </SectionCard>

            <SectionCard title="Today's Tasks" onSeeAll={navigateToTasks}>
              {todaysTasks.length === 0 ? (
                <Text style={styles.sectionEmpty}>No tasks due today.</Text>
              ) : (
                todaysTasks.slice(0, 5).map((t) => (
                  <Pressable key={t.id} style={styles.notificationRow} onPress={() => openTask(t.id)}>
                    <View style={styles.notificationTitleRow}>
                      <Text style={styles.notificationTitle} numberOfLines={1}>
                        {t.title}
                      </Text>
                      <StatusChip status={t.status} />
                    </View>
                    <Text style={styles.notificationMeta}>Due: {t.dueDate ? new Date(t.dueDate).toLocaleString() : 'No due date'}</Text>
                  </Pressable>
                ))
              )}
            </SectionCard>

            <SectionCard title="Open Issues" onSeeAll={navigateToIssues}>
              {openIssues.length === 0 ? (
                <Text style={styles.sectionEmpty}>No open issues.</Text>
              ) : (
                openIssues.slice(0, 5).map((i) => (
                  <Pressable key={i.id} style={styles.notificationRow} onPress={() => openIssue(i.id)}>
                    <View style={styles.notificationTitleRow}>
                      <Text style={styles.notificationTitle} numberOfLines={1}>
                        {i.title}
                      </Text>
                      <StatusChip status={i.status} />
                    </View>
                    <Text style={styles.notificationMeta}>
                      {i.type ? `${i.type} • ` : ''}Updated: {i.updatedAt ? new Date(i.updatedAt).toLocaleString() : 'n/a'}
                    </Text>
                  </Pressable>
                ))
              )}
            </SectionCard>

            <Text style={styles.jobsHeader}>Assigned Jobs</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No assigned jobs.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => navigation.navigate('JobDetail', { jobId: item.id })}>
            <View style={styles.row}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.jobNumber} - {item.title}
              </Text>
              <StatusChip status={item.status} />
            </View>
            <Text style={styles.meta}>{item.client?.name || 'No client'}</Text>
            <Text style={styles.meta}>
              {item.address?.street ? `${item.address.street}, ${item.address.city || ''} ${item.address.state || ''}` : 'No job site address'}
            </Text>
            <Text style={styles.meta}>{item.scheduledStart ? new Date(item.scheduledStart).toLocaleString() : 'No schedule'}</Text>
            <View style={styles.iconRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={14} color={(unreadMessagesByJob.get(item.id) || 0) > 0 ? BRAND.primary : '#98A2B3'} />
              <Ionicons name="images-outline" size={14} color={(todayMediaQuery.data?.get(item.id) || 0) > 0 ? BRAND.primary : '#98A2B3'} />
              <Ionicons name="alert-circle-outline" size={14} color={openIssues.some((x) => x.jobId === item.id) ? '#B42318' : '#98A2B3'} />
            </View>
          </Pressable>
        )}
      />
    </Screen>
  )
}

function SectionCard({ title, onSeeAll, children }: { title: string; onSeeAll?: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {onSeeAll ? (
          <Pressable onPress={onSeeAll} hitSlop={8}>
            <Text style={styles.sectionLink}>See all</Text>
          </Pressable>
        ) : (
          <View />
        )}
      </View>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14 },
  listHeader: { gap: 10, paddingBottom: 6 },
  header: { fontSize: 26, fontWeight: '800', color: BRAND.text },
  jobsHeader: { fontSize: 18, fontWeight: '800', color: BRAND.text, marginTop: 2 },
  empty: { color: BRAND.muted, textAlign: 'center', marginTop: 48 },
  sectionCard: {
    backgroundColor: BRAND.white,
    borderRadius: 14,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#EAECF0',
    shadowColor: '#101828',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: BRAND.text },
  sectionLink: { color: BRAND.primary, fontWeight: '700' },
  sectionEmpty: { color: BRAND.muted },
  notificationRow: { borderTopWidth: 1, borderTopColor: '#EAECF0', paddingTop: 10 },
  todayJobCard: { borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 12, padding: 10, backgroundColor: '#FCFCFD' },
  notificationTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  notificationTitle: { flex: 1, color: BRAND.text, fontWeight: '700' },
  notificationMeta: { marginTop: 4, color: BRAND.muted, fontSize: 12 },
  card: {
    backgroundColor: BRAND.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
    shadowColor: '#101828',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 },
  cardTitle: { fontWeight: '700', fontSize: 16, color: BRAND.text, flex: 1 },
  meta: { fontSize: 13, color: BRAND.muted, marginBottom: 2 },
  iconRow: { marginTop: 6, flexDirection: 'row', gap: 8, alignItems: 'center' },
})

