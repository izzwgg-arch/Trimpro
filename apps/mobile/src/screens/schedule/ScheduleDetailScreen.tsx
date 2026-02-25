import React from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { colors, spacing, typography } from '../../theme/tokens'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { useAuth } from '../../auth/AuthContext'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { ScheduleStackParamList } from '../../types/navigation'

type Props = NativeStackScreenProps<ScheduleStackParamList, 'ScheduleDetail'>

interface ScheduleDetailResponse {
  schedule: {
    id: string
    title: string
    description: string | null
    type: string
    startTime: string
    endTime: string
    allDay: boolean
    userId: string
    user?: { id: string; firstName: string; lastName: string; email?: string }
    job?: { id: string; jobNumber: string; title: string } | null
  }
}

export function ScheduleDetailScreen({ navigation, route }: Props) {
  const { scheduleId } = route.params
  const { user } = useAuth()
  const { canCreateSchedulesForOthers } = useMobilePermissions()
  const queryClient = useQueryClient()

  const detailQuery = useQuery({
    queryKey: ['mobile-schedule-detail', scheduleId],
    queryFn: () => apiRequest<ScheduleDetailResponse>(`/api/schedules/${scheduleId}`),
  })

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest<{ message: string }>(`/api/schedules/${scheduleId}`, 'DELETE'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-schedule'] })
      Alert.alert('Deleted', 'Schedule deleted successfully.')
      navigation.navigate('ScheduleHome')
    },
    onError: (error: any) => {
      Alert.alert('Delete failed', error?.message || 'Unable to delete this schedule.')
    },
  })

  if (detailQuery.isLoading) {
    return (
      <AppScreen>
        <EmptyState icon="calendar-outline" title="Loading schedule..." description="Please wait." />
      </AppScreen>
    )
  }

  if (detailQuery.isError || !detailQuery.data?.schedule) {
    return (
      <AppScreen>
        <EmptyState icon="alert-circle-outline" title="Schedule unavailable" description="This schedule could not be loaded." />
      </AppScreen>
    )
  }

  const schedule = detailQuery.data.schedule
  const canManage = user?.role === 'ADMIN' || canCreateSchedulesForOthers() || schedule.userId === user?.id

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.title}>{schedule.title || 'Untitled schedule'}</Text>
          <Text style={styles.meta}>
            {new Date(schedule.startTime).toLocaleString()} - {new Date(schedule.endTime).toLocaleString()}
          </Text>
          <Text style={styles.meta}>Type: {schedule.type}</Text>
          {schedule.user ? (
            <Text style={styles.meta}>
              Assigned to: {schedule.user.firstName} {schedule.user.lastName}
            </Text>
          ) : null}
          {schedule.job ? (
            <Text style={styles.meta}>
              Job: {schedule.job.jobNumber} - {schedule.job.title}
            </Text>
          ) : null}
          {schedule.description ? <Text style={styles.description}>{schedule.description}</Text> : null}
        </Card>

        {canManage ? (
          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.button, styles.editButton]}
              onPress={() => navigation.navigate('ScheduleCreate', { scheduleId })}
            >
              <Text style={styles.buttonText}>Edit</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.deleteButton]}
              onPress={() =>
                Alert.alert('Delete schedule', 'Are you sure you want to delete this schedule?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
                ])
              }
            >
              <Text style={styles.buttonText}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  title: { ...typography.h3, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  description: { ...typography.body, color: colors.textPrimary, marginTop: spacing.sm },
  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButton: { backgroundColor: colors.brandPrimary },
  deleteButton: { backgroundColor: colors.danger },
  buttonText: { ...typography.sub, color: '#fff', fontWeight: '700' },
})

