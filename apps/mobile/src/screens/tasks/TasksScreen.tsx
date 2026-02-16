import React from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { Task } from '../../types/models'
import { StatusChip } from '../../components/StatusChip'
import { BRAND } from '../../config/env'
import { TasksStackParamList } from '../../types/navigation'

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
    <Screen style={styles.screen}>
      <Text style={styles.title}>Tasks</Text>
      <FlatList
        data={query.data?.tasks ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        ListEmptyComponent={<Text style={styles.empty}>No assigned tasks.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}
          >
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <StatusChip status={item.status} />
            </View>
            <Text style={styles.meta}>{item.description || 'No description'}</Text>
            <Text style={styles.meta}>Priority: {item.priority}</Text>
          </Pressable>
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
  cardTitle: { color: BRAND.text, fontWeight: '700', flex: 1, marginRight: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  meta: { color: BRAND.muted, fontSize: 13 },
})

