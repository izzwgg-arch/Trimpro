import React from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { Task } from '../../types/models'
import { TasksStackParamList } from '../../types/navigation'
import { colors, spacing, typography } from '../../theme/tokens'
import { EmptyState } from '../../components/EmptyState'
import { PressableCard } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import { SectionHeader } from '../../components/SectionHeader'

interface TasksResponse {
  tasks: Task[]
}

type Props = NativeStackScreenProps<TasksStackParamList, 'TasksList'>

export function TasksScreen({ navigation }: Props) {
  const query = useQuery({
    queryKey: ['mobile-tasks'],
    queryFn: () => apiRequest<TasksResponse>('/api/tasks?filter=assigned&limit=100'),
    refetchInterval: 60_000,
  })

  return (
    <AppScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Tasks</Text>
        <Text style={styles.subtitle}>Assigned work prioritized for field execution.</Text>
      </View>
      <FlatList
        data={query.data?.tasks ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        ListHeaderComponent={<SectionHeader title="Assigned Tasks" />}
        ListEmptyComponent={<EmptyState icon="checkbox-outline" title="No assigned tasks" description="You have no pending tasks right now." />}
        renderItem={({ item }) => (
          <PressableCard
            style={styles.card}
            onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}
          >
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.meta}>{item.description || 'No description'}</Text>
            <Text style={styles.meta}>Priority: {item.priority}</Text>
          </PressableCard>
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
  cardTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '700', flex: 1, marginRight: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  meta: { ...typography.caption, color: colors.textSecondary },
})

