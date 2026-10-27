import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { apiRequest } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { TeamSection } from '../../components/team/TeamSection'
import { defaultRoleForUser, type TeamEntry, type TeamMember } from '../../lib/team'
import { combineDateAndTime } from '../../utils/schedule'
import { colors, radius, spacing, typography } from '../../theme/tokens'

export type TaskCreateParams = {
  jobId?: string
  jobNumber?: string
  jobTitle?: string
}

type PickerUser = { id: string; firstName: string; lastName: string; role?: string | null }

const PRIORITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
] as const
type Priority = (typeof PRIORITIES)[number]['value']

const nameOf = (u: { firstName?: string | null; lastName?: string | null }) =>
  `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown'

/**
 * New task form (same fields as the web's New Task page). Opened from a job it
 * starts linked to that job; nothing is saved until "Create Task" is pressed.
 */
export function TaskCreateScreen({ navigation, route }: { navigation: any; route: { params?: TaskCreateParams } }) {
  const params = route.params || {}
  const { user } = useAuth()
  const { canAssignTasksToAdmin } = useMobilePermissions()
  const queryClient = useQueryClient()
  const canPickTeam = canAssignTasksToAdmin()

  const [title, setTitle] = useState(params.jobNumber ? `${params.jobNumber} - ` : '')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('MEDIUM')
  const [dueDate, setDueDate] = useState<Date | null>(null)
  const [dueTime, setDueTime] = useState<Date | null>(null)
  const [showIosDate, setShowIosDate] = useState(false)
  const [showIosTime, setShowIosTime] = useState(false)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [saving, setSaving] = useState(false)
  const teamTouched = useRef(false)

  // Same list (and cache) the team sheet uses, so picked people get their names.
  const usersQuery = useQuery({
    queryKey: ['assignable-users'],
    queryFn: () => apiRequest<{ users: PickerUser[] }>('/api/assignments/users'),
    enabled: canPickTeam,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const adminsQuery = useQuery({
    queryKey: ['task-create-admins'],
    queryFn: () => apiRequest<{ users: PickerUser[] }>('/api/users?role=ADMIN&limit=10'),
    enabled: canPickTeam,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const usersById = useMemo(() => {
    const map = new Map<string, PickerUser>()
    for (const u of [...(adminsQuery.data?.users || []), ...(usersQuery.data?.users || [])]) map.set(u.id, u)
    return map
  }, [usersQuery.data, adminsQuery.data])

  // Start with the same person the old one-tap button used (the first admin/office user),
  // or yourself when you can't assign to others. It can be changed before saving.
  useEffect(() => {
    if (teamTouched.current || team.length > 0) return
    if (!canPickTeam) {
      if (user) setTeam([{ userId: user.id, name: nameOf(user), role: defaultRoleForUser(user.role) }])
      return
    }
    const admin = (adminsQuery.data?.users || []).find((u) => u.role === 'ADMIN' || u.role === 'OFFICE')
    if (admin) setTeam([{ userId: admin.id, name: nameOf(admin), role: defaultRoleForUser(admin.role) }])
  }, [adminsQuery.data, canPickTeam, user, team.length])

  const saveTeam = async (entries: TeamEntry[]) => {
    teamTouched.current = true
    setTeam(
      entries.map((e) => {
        const u = usersById.get(e.userId)
        return { userId: e.userId, role: e.role, name: u ? nameOf(u) : team.find((m) => m.userId === e.userId)?.name || 'Unknown' }
      })
    )
  }

  const openPicker = (mode: 'date' | 'time') => {
    const current = mode === 'date' ? dueDate : dueTime
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current ?? new Date(),
        mode,
        onChange: (_e, d) => {
          if (!d) return
          if (mode === 'date') setDueDate(d)
          else setDueTime(d)
        },
      })
    } else if (mode === 'date') {
      setShowIosDate((v) => !v)
    } else {
      setShowIosTime((v) => !v)
    }
  }

  const create = async () => {
    if (!title.trim()) return Alert.alert('Title required', 'Give the task a title.')
    if (saving) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        status: 'TODO',
        // A date without a time is kept at midday so it never slips a day across time zones.
        dueDate: dueDate ? combineDateAndTime(dueDate, dueTime ?? new Date(2000, 0, 1, 12, 0)) : null,
        jobId: params.jobId || null,
      }
      if (team.length > 0) body.assignments = team.map((m) => ({ userId: m.userId, role: m.role }))
      const res = await apiRequest<{ task?: { id: string } }>('/api/tasks?mobile=true', 'POST', body)
      queryClient.invalidateQueries({ queryKey: ['mobile-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['mobile-assignments'] })
      if (params.jobId) {
        queryClient.invalidateQueries({ queryKey: ['admin-job', params.jobId] })
        queryClient.invalidateQueries({ queryKey: ['mobile-job', params.jobId] })
      }
      navigation.goBack()
      const taskId = res?.task?.id
      Alert.alert('Task created', title.trim(), [
        { text: 'OK', style: 'cancel' },
        ...(taskId
          ? [
              {
                text: 'Open task',
                onPress: () =>
                  (navigation.getParent() as any)?.navigate('TasksTab', { screen: 'TaskDetail', params: { taskId } }),
              },
            ]
          : []),
      ])
    } catch (error: any) {
      Alert.alert('Could not create task', error?.message || 'Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.screen}>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} bottomOffset={spacing.lg} keyboardShouldPersistTaps="handled">
        {params.jobId ? (
          <View style={styles.jobChip}>
            <Ionicons name="briefcase-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.jobChipText} numberOfLines={1}>
              {[params.jobNumber, params.jobTitle].filter(Boolean).join(' · ') || 'Linked job'}
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>Title *</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="What needs to be done?"
          placeholderTextColor={colors.muted}
          autoFocus
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Details, measurements, anything the team should know…"
          placeholderTextColor={colors.muted}
          multiline
        />

        <Text style={styles.label}>Priority</Text>
        <View style={styles.chips}>
          {PRIORITIES.map((p) => {
            const active = priority === p.value
            return (
              <Pressable key={p.value} style={[styles.chip, active && styles.chipActive]} onPress={() => setPriority(p.value)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.label}>Due</Text>
        <View style={styles.row}>
          <Pressable style={styles.pickerButton} onPress={() => openPicker('date')}>
            <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
            <Text style={dueDate ? styles.pickerValue : styles.pickerPlaceholder}>
              {dueDate ? dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date'}
            </Text>
            {dueDate ? (
              <Pressable onPress={() => setDueDate(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </Pressable>
          <Pressable style={styles.pickerButton} onPress={() => openPicker('time')}>
            <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
            <Text style={dueTime ? styles.pickerValue : styles.pickerPlaceholder}>
              {dueTime ? dueTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Time'}
            </Text>
            {dueTime ? (
              <Pressable onPress={() => setDueTime(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </Pressable>
        </View>
        {Platform.OS === 'ios' && showIosDate ? (
          <DateTimePicker value={dueDate ?? new Date()} mode="date" display="spinner" onChange={(_e, d) => d && setDueDate(d)} />
        ) : null}
        {Platform.OS === 'ios' && showIosTime ? (
          <DateTimePicker value={dueTime ?? new Date()} mode="time" display="spinner" onChange={(_e, d) => d && setDueTime(d)} />
        ) : null}

        <TeamSection title="Assigned team" team={team} canEdit={canPickTeam} onSave={saveTeam} />

        <View style={[styles.row, { marginTop: spacing.sm }]}>
          <Pressable style={styles.cancelButton} onPress={() => navigation.goBack()} disabled={saving}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.saveButton, (!title.trim() || saving) && styles.disabled]}
            onPress={create}
            disabled={!title.trim() || saving}
          >
            {saving ? <ActivityIndicator color="#E6C98B" /> : <Text style={styles.saveText}>Create Task</Text>}
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.md },
  content: { gap: spacing.xs, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  jobChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing.xs,
  },
  jobChipText: { ...typography.caption, color: colors.brandPrimary, fontWeight: '700', flexShrink: 1 },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', marginTop: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    backgroundColor: '#FFFFFF',
    fontSize: 16,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipTextActive: { color: '#E6C98B' },
  row: { flexDirection: 'row', gap: spacing.sm },
  pickerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  pickerValue: { ...typography.caption, color: colors.textPrimary, flex: 1, fontSize: 14 },
  pickerPlaceholder: { ...typography.caption, color: colors.textSecondary, flex: 1, fontSize: 14 },
  cancelButton: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
  },
  cancelText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  saveButton: {
    flex: 2,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brandPrimary,
  },
  saveText: { fontSize: 16, fontWeight: '700', color: '#E6C98B' },
  disabled: { opacity: 0.6 },
})
