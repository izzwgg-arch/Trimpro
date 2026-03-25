import React, { useState } from 'react'
import { Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
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
import { useAuth } from '../../auth/AuthContext'

interface TasksResponse {
  tasks: Task[]
}

type Props = NativeStackScreenProps<TasksStackParamList, 'TasksList'>

export function TasksScreen({ navigation }: Props) {
  const { canCreateTasks, canAssignTasksToAdmin } = useMobilePermissions()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskNotes, setTaskNotes] = useState('')
  const [taskDueDate, setTaskDueDate] = useState<Date | null>(null)
  const [taskReminder, setTaskReminder] = useState<Date | null>(null)
  const [showDueDatePicker, setShowDueDatePicker] = useState(false)
  const [showReminderPicker, setShowReminderPicker] = useState(false)

  const query = useQuery({
    queryKey: ['mobile-tasks'],
    queryFn: () => apiRequest<TasksResponse>('/api/tasks?filter=assigned&limit=100'),
    refetchInterval: 60_000,
  })

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) {
        throw new Error('Unable to determine current user')
      }

      let assigneeId = user.id

      if (canAssignTasksToAdmin()) {
        const usersResponse = await apiRequest<{ users: Array<{ id: string; role: string; firstName: string; lastName: string }> }>(
          '/api/users?role=ADMIN&limit=10'
        )
        const adminUsers = usersResponse.users.filter((u) => u.role === 'ADMIN' || u.role === 'OFFICE')
        if (adminUsers.length > 0) {
          assigneeId = adminUsers[0].id
        }
      }

      const descriptionWithNotes = [taskDescription.trim(), taskNotes.trim() ? `Notes:\n${taskNotes.trim()}` : '']
        .filter(Boolean)
        .join('\n\n')
      
      return apiRequest('/api/tasks?mobile=true', 'POST', {
        title: taskTitle.trim(),
        description: descriptionWithNotes || null,
        assigneeId,
        priority: 'MEDIUM',
        status: 'TODO',
        dueDate: taskDueDate ? taskDueDate.toISOString() : null,
        reminderAt: taskReminder ? taskReminder.toISOString() : null,
      })
    },
    onSuccess: () => {
      setTaskDueDate(null)
      setTaskReminder(null)
      setShowDueDatePicker(false)
      setShowReminderPicker(false)
      queryClient.invalidateQueries({ queryKey: ['mobile-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['mobile-assignments'] })
      setTaskTitle('')
      setTaskDescription('')
      setTaskNotes('')
      setShowCreateForm(false)
      Alert.alert('Success', 'Task created successfully')
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
          {canCreateTasks() && (
            <Pressable
              style={styles.createButton}
              onPress={() => setShowCreateForm((prev) => !prev)}
              disabled={createTaskMutation.isPending}
            >
              <Ionicons name="add" size={24} color="#E6C98B" />
            </Pressable>
          )}
        </View>
      </View>
      {showCreateForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Create Task</Text>
          <TextInput
            style={styles.input}
            placeholder="Title"
            placeholderTextColor={colors.textPrimary}
            selectionColor={colors.textPrimary}
            cursorColor={colors.textPrimary}
            value={taskTitle}
            onChangeText={setTaskTitle}
          />
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder="Description"
            placeholderTextColor={colors.textPrimary}
            selectionColor={colors.textPrimary}
            cursorColor={colors.textPrimary}
            value={taskDescription}
            onChangeText={setTaskDescription}
            multiline
          />
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder="Notes"
            placeholderTextColor={colors.textPrimary}
            selectionColor={colors.textPrimary}
            cursorColor={colors.textPrimary}
            value={taskNotes}
            onChangeText={setTaskNotes}
            multiline
          />

          <Pressable
            style={styles.datePickerButton}
            onPress={() => {
              if (Platform.OS === 'android') {
                DateTimePickerAndroid.open({
                  value: taskDueDate ?? new Date(),
                  mode: 'date',
                  onChange: (_e, d) => { if (d) setTaskDueDate(d) },
                })
              } else {
                setShowDueDatePicker(!showDueDatePicker)
              }
            }}
          >
            <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.datePickerText}>
              {taskDueDate ? taskDueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Set due date'}
            </Text>
            {taskDueDate ? (
              <Pressable onPress={() => setTaskDueDate(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </Pressable>
          {Platform.OS === 'ios' && showDueDatePicker ? (
            <DateTimePicker
              value={taskDueDate ?? new Date()}
              mode="date"
              display="spinner"
              onChange={(_e, d) => { if (d) setTaskDueDate(d) }}
            />
          ) : null}
          <Pressable
            style={styles.datePickerButton}
            onPress={() => {
              if (Platform.OS === 'android') {
                DateTimePickerAndroid.open({
                  value: taskReminder ?? new Date(),
                  mode: 'time',
                  onChange: (_e, d) => { if (d) setTaskReminder(d) },
                })
              } else {
                setShowReminderPicker(!showReminderPicker)
              }
            }}
          >
            <Ionicons name="notifications-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.datePickerText}>
              {taskReminder ? taskReminder.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Set reminder'}
            </Text>
            {taskReminder ? (
              <Pressable onPress={() => setTaskReminder(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </Pressable>
          {Platform.OS === 'ios' && showReminderPicker ? (
            <DateTimePicker
              value={taskReminder ?? new Date()}
              mode="time"
              display="spinner"
              onChange={(_e, d) => { if (d) setTaskReminder(d) }}
            />
          ) : null}          <View style={styles.formActions}>
            <Pressable
              style={[styles.actionButton, styles.cancelButton]}
              onPress={() => {
                setShowCreateForm(false)
                setTaskTitle('')
                setTaskDescription('')
                setTaskNotes('')
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.saveButton, (!taskTitle.trim() || createTaskMutation.isPending) && styles.disabledButton]}
              onPress={() => createTaskMutation.mutate()}
              disabled={!taskTitle.trim() || createTaskMutation.isPending}
            >
              <Text style={styles.saveButtonText}>{createTaskMutation.isPending ? 'Saving...' : 'Create'}</Text>
            </Pressable>
          </View>
        </View>
      )}
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
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    gap: spacing.xs,
  },
  formTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    backgroundColor: '#FFFFFF',
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: 4,
  },
  actionButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
  },
  saveButton: {
    backgroundColor: colors.brandPrimary,
  },
  cancelButtonText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  saveButtonText: {
    ...typography.caption,
    color: '#E6C98B',
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FAFAFA',
  },
  datePickerText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    fontSize: 13,
  },
})

