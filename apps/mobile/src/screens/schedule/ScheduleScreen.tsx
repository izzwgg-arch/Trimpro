import React from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { ScheduleItem } from '../../types/models'
import { useAuth } from '../../auth/AuthContext'
import { colors, spacing, typography } from '../../theme/tokens'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { SectionHeader } from '../../components/SectionHeader'

interface ScheduleResponse {
  schedules: ScheduleItem[]
}

export function ScheduleScreen() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['mobile-schedule', user?.id],
    queryFn: () => apiRequest<ScheduleResponse>(`/api/schedules?view=week&userId=${user?.id || 'all'}`),
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
  })

  return (
    <AppScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Schedule</Text>
        <Text style={styles.subtitle}>Weekly timeline for your assigned work.</Text>
      </View>
      <FlatList
        data={query.data?.schedules ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        ListHeaderComponent={<SectionHeader title="This Week" />}
        ListEmptyComponent={
          <EmptyState icon="calendar-outline" title="No schedule items" description="New assignments appear here automatically." />
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.meta}>
              {new Date(item.startTime).toLocaleString()} - {new Date(item.endTime).toLocaleString()}
            </Text>
            <Text style={styles.meta}>{item.job ? `${item.job.jobNumber} - ${item.job.title}` : item.type}</Text>
          </Card>
        )}
      />
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  card: { marginBottom: spacing.sm },
  cardTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '700', marginBottom: 4 },
  meta: { ...typography.caption, color: colors.textSecondary },
})

