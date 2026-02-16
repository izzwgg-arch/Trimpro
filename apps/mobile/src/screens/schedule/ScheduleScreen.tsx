import React from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { ScheduleItem } from '../../types/models'
import { BRAND } from '../../config/env'
import { useAuth } from '../../auth/AuthContext'

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
    <Screen style={styles.screen}>
      <Text style={styles.title}>Schedule</Text>
      <FlatList
        data={query.data?.schedules ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        ListEmptyComponent={<Text style={styles.empty}>No schedule items.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.meta}>
              {new Date(item.startTime).toLocaleString()} - {new Date(item.endTime).toLocaleString()}
            </Text>
            <Text style={styles.meta}>{item.job ? `${item.job.jobNumber} - ${item.job.title}` : item.type}</Text>
          </View>
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14 },
  title: { fontSize: 24, fontWeight: '800', color: BRAND.text, marginBottom: 12 },
  empty: { textAlign: 'center', color: BRAND.muted, marginTop: 42 },
  card: { backgroundColor: BRAND.white, borderRadius: 14, padding: 12, marginBottom: 10 },
  cardTitle: { color: BRAND.text, fontWeight: '700', marginBottom: 4 },
  meta: { color: BRAND.muted, fontSize: 13 },
})

