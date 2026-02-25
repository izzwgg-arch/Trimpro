import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { colors, spacing, typography } from '../../theme/tokens'
import { Card } from '../../components/Card'
import { useAuth } from '../../auth/AuthContext'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { ScheduleStackParamList } from '../../types/navigation'

type Props = NativeStackScreenProps<ScheduleStackParamList, 'ScheduleCreate'>

interface TeamMembersResponse {
  teamMembers: Array<{ id: string; firstName: string; lastName: string }>
}

interface JobsResponse {
  jobs: Array<{ id: string; jobNumber: string; title: string }>
}

interface ScheduleDetailResponse {
  schedule: {
    id: string
    title: string
    description: string | null
    type: string
    startTime: string
    endTime: string
    userId: string
    jobId: string | null
  }
}

export function ScheduleCreateScreen({ navigation, route }: Props) {
  const scheduleId = route.params?.scheduleId
  const isEdit = Boolean(scheduleId)
  const { user } = useAuth()
  const { canCreateSchedulesForOthers } = useMobilePermissions()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [type, setType] = useState<'OTHER' | 'JOB' | 'MEETING' | 'FOLLOW_UP'>('OTHER')
  const [assignedUserId, setAssignedUserId] = useState('')
  const [jobId, setJobId] = useState('')
  const [startAt, setStartAt] = useState<Date>(new Date())
  const [endAt, setEndAt] = useState<Date>(() => new Date(Date.now() + 60 * 60 * 1000))
  const [iosPicker, setIosPicker] = useState<{ mode: 'date' | 'time'; target: 'start' | 'end' } | null>(null)

  const teamQuery = useQuery({
    queryKey: ['mobile-schedule-team-create'],
    queryFn: () => apiRequest<TeamMembersResponse>('/api/schedules/team'),
  })

  const jobsQuery = useQuery({
    queryKey: ['mobile-schedule-jobs-create'],
    queryFn: () => apiRequest<JobsResponse>('/api/mobile/jobs?limit=100&filter=assigned'),
  })

  const detailQuery = useQuery({
    queryKey: ['mobile-schedule-edit', scheduleId],
    queryFn: () => apiRequest<ScheduleDetailResponse>(`/api/schedules/${scheduleId}`),
    enabled: Boolean(scheduleId),
  })

  useEffect(() => {
    if (user?.id && !assignedUserId) {
      setAssignedUserId(user.id)
    }
  }, [assignedUserId, user?.id])

  useEffect(() => {
    if (!detailQuery.data?.schedule) return
    const s = detailQuery.data.schedule
    setTitle(s.title || '')
    setNotes(s.description || '')
    setType((s.type as any) || 'OTHER')
    setAssignedUserId(s.userId || user?.id || '')
    setJobId(s.jobId || '')
    setStartAt(new Date(s.startTime))
    setEndAt(new Date(s.endTime))
  }, [detailQuery.data?.schedule, user?.id])

  const allowedAssignedUserId = useMemo(() => {
    if (canCreateSchedulesForOthers()) return assignedUserId || user?.id || ''
    return user?.id || ''
  }, [assignedUserId, canCreateSchedulesForOthers, user?.id])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        description: notes.trim() || null,
        type,
        startTime: startAt.toISOString(),
        endTime: endAt.toISOString(),
        assignedUserId: allowedAssignedUserId,
        jobId: jobId || null,
      }
      if (__DEV__) console.debug('[schedule] submit', { isEdit, payload })
      if (isEdit && scheduleId) {
        return apiRequest<{ schedule: { id: string } }>(`/api/schedules/${scheduleId}`, 'PUT', payload)
      }
      return apiRequest<{ schedule: { id: string } }>('/api/schedules', 'POST', payload)
    },
    onSuccess: (data) => {
      const createdId = data.schedule?.id || scheduleId
      void queryClient.invalidateQueries({ queryKey: ['mobile-schedule'] })
      Alert.alert('Success', isEdit ? 'Schedule updated.' : 'Schedule created.')
      if (createdId) {
        navigation.replace('ScheduleDetail', { scheduleId: createdId })
      } else {
        navigation.navigate('ScheduleHome')
      }
    },
    onError: (error: any) => {
      if (__DEV__) console.debug('[schedule] save error', error)
      Alert.alert('Save failed', error?.message || 'Unable to save schedule.')
    },
  })

  const openPicker = (mode: 'date' | 'time', target: 'start' | 'end') => {
    if (Platform.OS === 'ios') {
      setIosPicker({ mode, target })
      return
    }
    DateTimePickerAndroid.open({
      mode,
      value: target === 'start' ? startAt : endAt,
      onChange: (_event, value) => {
        if (!value) return
        const current = target === 'start' ? startAt : endAt
        const next = new Date(current)
        if (mode === 'date') {
          next.setFullYear(value.getFullYear(), value.getMonth(), value.getDate())
        } else {
          next.setHours(value.getHours(), value.getMinutes(), 0, 0)
        }
        if (target === 'start') setStartAt(next)
        else setEndAt(next)
      },
    })
  }

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.sectionTitle}>{isEdit ? 'Edit Schedule' : 'New Schedule'}</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Title</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Schedule title" style={styles.input} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Add details"
              style={[styles.input, styles.notesInput]}
              multiline
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Assigned User</Text>
            <View style={styles.selectorWrap}>
              {(teamQuery.data?.teamMembers || []).map((member) => {
                const selected = (allowedAssignedUserId || user?.id) === member.id
                const disabled = !canCreateSchedulesForOthers() && member.id !== user?.id
                return (
                  <Pressable
                    key={member.id}
                    disabled={disabled}
                    onPress={() => setAssignedUserId(member.id)}
                    style={[styles.chip, selected && styles.chipActive, disabled && styles.chipDisabled]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                      {member.firstName} {member.lastName}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Type</Text>
            <View style={styles.selectorWrap}>
              {(['OTHER', 'JOB', 'MEETING', 'FOLLOW_UP'] as const).map((item) => {
                const selected = item === type
                return (
                  <Pressable key={item} onPress={() => setType(item)} style={[styles.chip, selected && styles.chipActive]}>
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>{item}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Start</Text>
            <View style={styles.timeRow}>
              <Pressable style={styles.timeButton} onPress={() => openPicker('date', 'start')}>
                <Text style={styles.timeText}>{startAt.toLocaleDateString()}</Text>
              </Pressable>
              <Pressable style={styles.timeButton} onPress={() => openPicker('time', 'start')}>
                <Text style={styles.timeText}>{startAt.toLocaleTimeString()}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>End</Text>
            <View style={styles.timeRow}>
              <Pressable style={styles.timeButton} onPress={() => openPicker('date', 'end')}>
                <Text style={styles.timeText}>{endAt.toLocaleDateString()}</Text>
              </Pressable>
              <Pressable style={styles.timeButton} onPress={() => openPicker('time', 'end')}>
                <Text style={styles.timeText}>{endAt.toLocaleTimeString()}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Link Job (optional)</Text>
            <View style={styles.selectorWrap}>
              <Pressable onPress={() => setJobId('')} style={[styles.chip, !jobId && styles.chipActive]}>
                <Text style={[styles.chipText, !jobId && styles.chipTextActive]}>None</Text>
              </Pressable>
              {(jobsQuery.data?.jobs || []).slice(0, 20).map((job) => {
                const selected = jobId === job.id
                return (
                  <Pressable key={job.id} onPress={() => setJobId(job.id)} style={[styles.chip, selected && styles.chipActive]}>
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>{job.jobNumber}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        </Card>

        <Pressable
          style={[styles.saveButton, saveMutation.isPending && { opacity: 0.7 }]}
          disabled={saveMutation.isPending || !title.trim()}
          onPress={() => {
            if (endAt <= startAt) {
              Alert.alert('Invalid time', 'End time must be after start time.')
              return
            }
            saveMutation.mutate()
          }}
        >
          <Text style={styles.saveText}>{saveMutation.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Schedule'}</Text>
        </Pressable>

        {iosPicker ? (
          <View style={styles.iosPickerWrap}>
            <DateTimePicker
              value={iosPicker.target === 'start' ? startAt : endAt}
              mode={iosPicker.mode}
              display="spinner"
              onChange={(_event, value) => {
                if (!value) return
                const current = iosPicker.target === 'start' ? startAt : endAt
                const next = new Date(current)
                if (iosPicker.mode === 'date') {
                  next.setFullYear(value.getFullYear(), value.getMonth(), value.getDate())
                } else {
                  next.setHours(value.getHours(), value.getMinutes(), 0, 0)
                }
                if (iosPicker.target === 'start') setStartAt(next)
                else setEndAt(next)
              }}
            />
            <Pressable style={styles.iosDoneButton} onPress={() => setIosPicker(null)}>
              <Text style={styles.iosDoneText}>Done</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs },
  field: { marginTop: spacing.sm },
  label: { ...typography.caption, color: colors.textSecondary, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  notesInput: { minHeight: 90, paddingTop: spacing.sm, textAlignVertical: 'top' },
  selectorWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 999,
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.brandPrimary, backgroundColor: 'rgba(15,76,92,0.14)' },
  chipDisabled: { opacity: 0.45 },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: colors.brandPrimary },
  timeRow: { flexDirection: 'row', gap: spacing.sm },
  timeButton: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  timeText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  saveButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { ...typography.sub, color: '#fff', fontWeight: '700' },
  iosPickerWrap: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: spacing.xs,
  },
  iosDoneButton: {
    alignSelf: 'flex-end',
    minHeight: 36,
    minWidth: 80,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosDoneText: { ...typography.caption, color: '#fff', fontWeight: '700' },
})

