import React from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { Task } from '../../types/models'
import { TasksStackParamList } from '../../types/navigation'
import { colors, spacing, typography } from '../../theme/tokens'
import { EmptyState } from '../../components/EmptyState'
import { PressableCard } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import { SectionHeader } from '../../components/SectionHeader'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'

interface TasksResponse {
  tasks: Task[]
}

type Props = NativeStackScreenProps<TasksStackParamList, 'TasksList'>

export function TasksScreen({ navigation }: Props) {
  const { canCreateTasks, canAssignTasksToAdmin } = useMobilePermissions()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['mobile-tasks'],
    queryFn: () => apiRequest<TasksResponse>('/api/tasks?filter=assigned&limit=100'),
    refetchInterval: 60_000,
  })

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      // Get admin users for assignment
      const usersResponse = await apiRequest<{ users: Array<{ id: string; role: string; firstName: string; lastName: string }> }>(
        '/api/users?role=ADMIN&limit=10'
      )
      const adminUsers = usersResponse.users.filter((u) => u.role === 'ADMIN' || u.role === 'OFFICE')
      
      if (adminUsers.length === 0) {
        throw new Error('No admin users found to assign the task to.')
      }

      const assigneeId = adminUsers[0].id
      
      return apiRequest('/api/tasks?mobile=true', 'POST', {
        title: 'New Task',
        description: 'Task created from mobile app',
        assigneeId,
        priority: 'MEDIUM',
        status: 'TODO',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mobile-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['mobile-assignments'] })
      Alert.alert('Success', 'Task created and assigned to admin')
    },
    onError: (error: any) => {
      Alert.alert('Error', error?.message || 'Failed to create task')
    },
  })

  return (
    <AppScreen>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Tasks</Text>
            <Text style={styles.subtitle}>Assigned work prioritized for field execution.</Text>
          </View>
          {canCreateTasks() && canAssignTasksToAdmin() && (
            <Pressable
              style={styles.createButton}
              onPress={() => createTaskMutation.mutate()}
              disabled={createTaskMutation.isPending}
            >
              <Ionicons name="add" size={24} color="#E6C98B" />
            </Pressable>
          )}
        </View>
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { marginBottom: spacing.sm },
  cardTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '700', flex: 1, marginRight: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  meta: { ...typography.caption, color: colors.textSecondary },
})

