import React from 'react'
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { BRAND } from '../../config/env'
import { JobsStackParamList } from '../../types/navigation'

type Props = NativeStackScreenProps<JobsStackParamList, 'NotificationSettings'>

type PrefKey =
  | 'emailNotifications'
  | 'newJobAssigned'
  | 'jobStatusChanges'
  | 'requestStatusChanges'
  | 'newMessage'
  | 'paymentReceived'
  | 'taskAssigned'
  | 'taskUpdated'
  | 'taskOverdue'
  | 'issueAssigned'
  | 'issueUpdated'
  | 'attachmentUploaded'
  | 'scheduleReminder'
  | 'invoiceOverdue'
  | 'incomingCall'
  | 'incomingSms'

type Prefs = Record<PrefKey, boolean>

// Keep in sync with lib/notifications/preferences.ts (NOTIFICATION_PREFERENCE_META).
const ROWS: Array<{ key: PrefKey; title: string; description: string; defaultOff?: boolean }> = [
  { key: 'emailNotifications', title: 'Email notifications', description: 'Also send alerts to your account email (off by default).', defaultOff: true },
  { key: 'newJobAssigned', title: 'New job assigned', description: 'When a job is assigned to you.' },
  { key: 'jobStatusChanges', title: 'Job updates', description: 'When a job you are on changes status or schedule.' },
  { key: 'requestStatusChanges', title: 'Request updates', description: 'When a request you created or are assigned to changes.' },
  { key: 'newMessage', title: 'New messages', description: 'When you receive a chat or job message.' },
  { key: 'paymentReceived', title: 'Payment alerts', description: 'When a payment is received.' },
  { key: 'taskAssigned', title: 'Task assigned', description: 'When a task is assigned to you.' },
  { key: 'taskUpdated', title: 'Task updates', description: 'When a task you are on changes.' },
  { key: 'taskOverdue', title: 'Task overdue', description: 'When one of your tasks becomes overdue.' },
  { key: 'issueAssigned', title: 'Issue assigned', description: 'When an issue is assigned to you.' },
  { key: 'issueUpdated', title: 'Issue updates', description: 'When an issue you are on changes.' },
  { key: 'attachmentUploaded', title: 'Attachment uploaded', description: 'When a photo or file is added to a job you are on.' },
  { key: 'scheduleReminder', title: 'Schedule reminders', description: 'Reminders for your upcoming scheduled visits.' },
  { key: 'invoiceOverdue', title: 'Invoice overdue', description: 'When an invoice becomes overdue.' },
  { key: 'incomingCall', title: 'Incoming calls', description: 'When a call comes in for you.' },
  { key: 'incomingSms', title: 'Incoming texts', description: 'When a text message comes in for you.' },
]

const DEFAULTS: Prefs = ROWS.reduce((acc, r) => {
  acc[r.key] = !r.defaultOff
  return acc
}, {} as Prefs)

export function NotificationSettingsScreen({}: Props) {
  const queryClient = useQueryClient()

  const prefsQuery = useQuery({
    queryKey: ['mobile-notification-preferences'],
    queryFn: () => apiRequest<{ preferences: Prefs }>('/api/mobile/notification-preferences'),
  })

  const prefs = prefsQuery.data?.preferences || DEFAULTS

  const saveMutation = useMutation({
    mutationFn: (next: Prefs) =>
      apiRequest<{ preferences: Prefs }>('/api/mobile/notification-preferences', 'PATCH', {
        preferences: next,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['mobile-notification-preferences'], data)
    },
    onError: (error: any) => {
      Alert.alert('Could not save', error?.message || 'Please try again.')
      void prefsQuery.refetch()
    },
  })

  const toggle = (key: PrefKey, value: boolean) => {
    const next = { ...prefs, [key]: value }
    queryClient.setQueryData(['mobile-notification-preferences'], { preferences: next })
    saveMutation.mutate(next)
  }

  return (
    <Screen style={styles.screen}>
      <Text style={styles.title}>Notification settings</Text>
      <Text style={styles.subtitle}>Choose which alerts you want on this account.</Text>

      {prefsQuery.isLoading ? (
        <ActivityIndicator color={BRAND.primary} style={{ marginTop: 24 }} />
      ) : (
        <View style={styles.list}>
          {ROWS.map((row) => (
            <View key={row.key} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowDesc}>{row.description}</Text>
              </View>
              <Switch
                value={Boolean(prefs[row.key])}
                onValueChange={(value) => toggle(row.key, value)}
                trackColor={{ false: '#CBD5E1', true: BRAND.primary }}
              />
            </View>
          ))}
        </View>
      )}

      {saveMutation.isPending ? <Text style={styles.saving}>Saving…</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, backgroundColor: BRAND.bg },
  title: { fontSize: 22, fontWeight: '800', color: BRAND.text },
  subtitle: { marginTop: 6, color: BRAND.muted, fontSize: 13, marginBottom: 16 },
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: BRAND.white,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: BRAND.text },
  rowDesc: { fontSize: 12, color: BRAND.muted, lineHeight: 16 },
  saving: { marginTop: 12, color: BRAND.muted, fontSize: 12 },
})
