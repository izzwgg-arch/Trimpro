import React, { useMemo, useState } from 'react'
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { Conversation, Job } from '../../types/models'
import { SyncBanner } from '../../components/SyncBanner'
import { useOnlineState } from '../../hooks/useOnlineState'
import { useOutboxCount } from '../../hooks/useOutboxCount'
import { spacing } from '../../theme/tokens'
import { JobsStackParamList } from '../../types/navigation'
import { EmptyState } from '../../components/EmptyState'
import { JobCard } from '../../components/JobCard'
import { SectionHeader } from '../../components/SectionHeader'

type Props = NativeStackScreenProps<JobsStackParamList, 'JobsList'>

interface JobsResponse {
  jobs: Job[]
}

interface ConversationsResponse {
  conversations: Conversation[]
}

export function JobsScreen({ navigation }: Props) {
  const isOnline = useOnlineState()
  const outboxCount = useOutboxCount()
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)

  const jobsQuery = useQuery({
    queryKey: ['mobile-jobs-assigned'],
    queryFn: async () => {
      const data = await apiRequest<JobsResponse>('/api/mobile/jobs?limit=100&filter=assigned')
      setLastSyncAt(new Date())
      return data
    },
    refetchInterval: 60_000,
  })

  const conversationsQuery = useQuery({
    queryKey: ['mobile-conversations'],
    queryFn: () => apiRequest<ConversationsResponse>('/api/messages/conversations?assigned=me'),
    refetchInterval: 45_000,
  })

  const jobs = useMemo(() => {
    const list = jobsQuery.data?.jobs ?? []
    const byId = new Map<string, Job>()
    for (const job of list) {
      if (job?.id && !byId.has(job.id)) byId.set(job.id, job)
    }
    return Array.from(byId.values())
  }, [jobsQuery.data])

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

  const onRefresh = async () => {
    await Promise.all([jobsQuery.refetch(), conversationsQuery.refetch()])
  }

  return (
    <AppScreen>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={jobsQuery.isRefetching || conversationsQuery.isRefetching}
            onRefresh={() => void onRefresh()}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <SyncBanner
              isOnline={isOnline}
              isSyncing={jobsQuery.isFetching || conversationsQuery.isFetching}
              lastSyncAt={lastSyncAt}
              outboxCount={outboxCount}
            />
            <SectionHeader title="Assigned Jobs" />
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="briefcase-outline" title="No assigned jobs" description="You have no assigned jobs yet." />
        }
        renderItem={({ item }) => (
          <View style={styles.stackItem}>
            <JobCard
              job={item}
              onPress={() => navigation.navigate('JobDetail', { jobId: item.id })}
              hasUnreadMessages={(unreadMessagesByJob.get(item.id) || 0) > 0}
              hasNewMedia={false}
              hasOpenIssue={false}
            />
          </View>
        )}
      />
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  listHeader: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.md },
  stackItem: { marginBottom: spacing.sm },
})
