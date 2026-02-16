import React, { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { Issue, Job, Task } from '../../types/models'
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
  issues: Array<Pick<Issue, 'id' | 'title' | 'status' | 'priority' | 'type'> & { updatedAt: string }>
  serverTime: string
}

export function JobsScreen({ navigation }: Props) {
  const isOnline = useOnlineState()
  const outboxCount = useOutboxCount()
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)

  const jobsQuery = useQuery({
    queryKey: ['mobile-jobs'],
    queryFn: async () => {
      const data = await apiRequest<JobsResponse>('/api/mobile/jobs?limit=100')
      setLastSyncAt(new Date())
      return data
    },
    refetchInterval: 60_000,
  })

  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data])

  const assignmentsQuery = useQuery({
    queryKey: ['mobile-assignments'],
    queryFn: async () => {
      const data = await apiRequest<AssignmentsResponse>('/api/mobile/assignments')
      setLastSyncAt(new Date())
      return data
    },
    refetchInterval: 45_000,
  })

  const taskNotifications = useMemo(() => assignmentsQuery.data?.tasks ?? [], [assignmentsQuery.data])
  const issueNotifications = useMemo(() => assignmentsQuery.data?.issues ?? [], [assignmentsQuery.data])

  const navigateToTasks = () => {
    // Jump to the Tasks tab stack.
    navigation.getParent()?.navigate('TasksTab' as never)
  }

  const navigateToIssues = () => {
    // Issues live under More -> Issues.
    navigation.getParent()?.navigate('MoreTab' as never, { screen: 'Issues' } as never)
  }

  const openTask = (taskId: string) => {
    navigation
      .getParent()
      ?.navigate('TasksTab' as never, { screen: 'TaskDetail', params: { taskId } } as never)
  }

  const openIssue = (issueId: string) => {
    navigation
      .getParent()
      ?.navigate('MoreTab' as never, { screen: 'IssueDetail', params: { issueId } } as never)
  }

  const onRefreshAll = async () => {
    await Promise.all([jobsQuery.refetch(), assignmentsQuery.refetch()])
  }

  return (
    <Screen style={styles.screen}>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={jobsQuery.isRefetching || assignmentsQuery.isRefetching}
            onRefresh={() => onRefreshAll()}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.header}>Dashboard</Text>
            <SyncBanner
              isOnline={isOnline}
              isSyncing={jobsQuery.isFetching || assignmentsQuery.isFetching}
              lastSyncAt={lastSyncAt}
              outboxCount={outboxCount}
            />

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Task Notifications</Text>
                <Pressable onPress={navigateToTasks} hitSlop={8}>
                  <Text style={styles.sectionLink}>See all</Text>
                </Pressable>
              </View>
              {taskNotifications.length === 0 ? (
                <Text style={styles.sectionEmpty}>No assigned tasks.</Text>
              ) : (
                taskNotifications.slice(0, 6).map((t) => (
                  <Pressable key={t.id} style={styles.notificationRow} onPress={() => openTask(t.id)}>
                    <View style={styles.notificationTitleRow}>
                      <Text style={styles.notificationTitle} numberOfLines={1}>
                        {t.title}
                      </Text>
                      <StatusChip status={t.status} />
                    </View>
                    <Text style={styles.notificationMeta}>
                      Updated: {t.updatedAt ? new Date(t.updatedAt).toLocaleString() : 'n/a'}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Issue Notifications</Text>
                <Pressable onPress={navigateToIssues} hitSlop={8}>
                  <Text style={styles.sectionLink}>See all</Text>
                </Pressable>
              </View>
              {issueNotifications.length === 0 ? (
                <Text style={styles.sectionEmpty}>No assigned issues.</Text>
              ) : (
                issueNotifications.slice(0, 6).map((i) => (
                  <Pressable key={i.id} style={styles.notificationRow} onPress={() => openIssue(i.id)}>
                    <View style={styles.notificationTitleRow}>
                      <Text style={styles.notificationTitle} numberOfLines={1}>
                        {i.title}
                      </Text>
                      <StatusChip status={i.status} />
                    </View>
                    <Text style={styles.notificationMeta}>
                      {i.type ? `${i.type} • ` : ''}
                      Updated: {i.updatedAt ? new Date(i.updatedAt).toLocaleString() : 'n/a'}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>

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
              {item.address?.street
                ? `${item.address.street}, ${item.address.city || ''} ${item.address.state || ''}`
                : 'No job site address'}
            </Text>
            <Text style={styles.meta}>
              {item.scheduledStart ? new Date(item.scheduledStart).toLocaleString() : 'No schedule'}
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: {
    padding: 14,
  },
  listHeader: {
    gap: 10,
    paddingBottom: 6,
  },
  header: {
    fontSize: 26,
    fontWeight: '800',
    color: BRAND.text,
  },
  jobsHeader: {
    fontSize: 18,
    fontWeight: '800',
    color: BRAND.text,
    marginTop: 2,
  },
  empty: {
    color: BRAND.muted,
    textAlign: 'center',
    marginTop: 48,
  },
  sectionCard: {
    backgroundColor: BRAND.white,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: BRAND.text,
  },
  sectionLink: {
    color: BRAND.primary,
    fontWeight: '700',
  },
  sectionEmpty: {
    color: BRAND.muted,
  },
  notificationRow: {
    borderTopWidth: 1,
    borderTopColor: '#EAECF0',
    paddingTop: 10,
  },
  notificationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  notificationTitle: {
    flex: 1,
    color: BRAND.text,
    fontWeight: '700',
  },
  notificationMeta: {
    marginTop: 4,
    color: BRAND.muted,
    fontSize: 12,
  },
  card: {
    backgroundColor: BRAND.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  cardTitle: {
    fontWeight: '700',
    fontSize: 16,
    color: BRAND.text,
    flex: 1,
  },
  meta: {
    fontSize: 13,
    color: BRAND.muted,
    marginBottom: 2,
  },
})

