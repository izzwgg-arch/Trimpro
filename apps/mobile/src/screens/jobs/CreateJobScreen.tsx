import React, { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker from '@react-native-community/datetimepicker'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { Card } from '../../components/Card'
import { JobsStackParamList } from '../../types/navigation'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'

type Props = NativeStackScreenProps<JobsStackParamList, 'CreateJob'>

interface Client {
  id: string
  name: string
  companyName: string | null
}

interface ClientsResponse {
  clients: Client[]
}

export function CreateJobScreen({ navigation }: Props) {
  const { canScheduleJobs, canAssignJobs } = useMobilePermissions()
  const [formData, setFormData] = useState({
    clientId: '',
    title: '',
    description: '',
    status: 'QUOTE',
    priority: '3',
    scheduledStart: null as Date | null,
    scheduledEnd: null as Date | null,
    jobSite: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'US',
    },
  })
  const [showStartPicker, setShowStartPicker] = useState(false)
  const [showEndPicker, setShowEndPicker] = useState(false)

  const clientsQuery = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiRequest<ClientsResponse>('/api/clients?limit=1000'),
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        clientId: formData.clientId,
        title: formData.title,
        description: formData.description || null,
        status: formData.status,
        priority: parseInt(formData.priority),
      }

      if (canScheduleJobs() && formData.scheduledStart) {
        payload.scheduledStart = formData.scheduledStart.toISOString()
      }
      if (canScheduleJobs() && formData.scheduledEnd) {
        payload.scheduledEnd = formData.scheduledEnd.toISOString()
      }

      if (formData.jobSite.street || formData.jobSite.city) {
        payload.jobSite = formData.jobSite
      }

      return apiRequest('/api/jobs', 'POST', payload)
    },
    onSuccess: (data: any) => {
      Alert.alert('Success', 'Job created successfully', [
        {
          text: 'OK',
          onPress: () => navigation.navigate('AdminJobDetail', { jobId: data.job.id }),
        },
      ])
    },
    onError: (error: any) => {
      Alert.alert('Error', error?.message || 'Failed to create job')
    },
  })

  const clients = clientsQuery.data?.clients ?? []

  const handleSave = () => {
    if (!formData.clientId) {
      Alert.alert('Validation Error', 'Please select a client')
      return
    }
    if (!formData.title.trim()) {
      Alert.alert('Validation Error', 'Please enter a job title')
      return
    }
    createMutation.mutate()
  }

  return (
    <AppScreen>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Create Job</Text>
        <Pressable onPress={handleSave} style={styles.saveButton} disabled={createMutation.isPending}>
          <Text style={styles.saveButtonText}>{createMutation.isPending ? 'Saving...' : 'Save'}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Card style={styles.card}>
          <Text style={styles.label}>Client *</Text>
          <View style={styles.selectContainer}>
            <Text style={styles.selectText}>
              {formData.clientId ? clients.find((c) => c.id === formData.clientId)?.name || 'Select client' : 'Select client'}
            </Text>
            <Pressable
              style={styles.selectButton}
              onPress={() => {
                // Simple client picker - in production, use a proper modal/picker
                Alert.alert(
                  'Select Client',
                  'Client picker coming soon',
                  clients.slice(0, 5).map((client) => ({
                    text: client.name,
                    onPress: () => setFormData((prev) => ({ ...prev, clientId: client.id })),
                  }))
                )
              }}
            >
              <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.label}>Job Title *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter job title"
            value={formData.title}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, title: text }))}
          />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Enter job description"
            multiline
            numberOfLines={4}
            value={formData.description}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, description: text }))}
          />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.label}>Status</Text>
          <View style={styles.statusRow}>
            {['QUOTE', 'SCHEDULED', 'IN_PROGRESS'].map((status) => (
              <Pressable
                key={status}
                style={[styles.statusChip, formData.status === status && styles.statusChipActive]}
                onPress={() => setFormData((prev) => ({ ...prev, status }))}
              >
                <Text style={[styles.statusChipText, formData.status === status && styles.statusChipTextActive]}>
                  {status.replace('_', ' ')}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {canScheduleJobs() && (
          <>
            <Card style={styles.card}>
              <Text style={styles.label}>Scheduled Start</Text>
              <Pressable style={styles.dateButton} onPress={() => setShowStartPicker(true)}>
                <Text style={styles.dateText}>
                  {formData.scheduledStart ? formData.scheduledStart.toLocaleString() : 'Select date/time'}
                </Text>
                <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
              </Pressable>
              {showStartPicker && (
                <DateTimePicker
                  value={formData.scheduledStart || new Date()}
                  mode="datetime"
                  onChange={(event, date) => {
                    setShowStartPicker(false)
                    if (date) setFormData((prev) => ({ ...prev, scheduledStart: date }))
                  }}
                />
              )}
            </Card>

            <Card style={styles.card}>
              <Text style={styles.label}>Scheduled End</Text>
              <Pressable style={styles.dateButton} onPress={() => setShowEndPicker(true)}>
                <Text style={styles.dateText}>
                  {formData.scheduledEnd ? formData.scheduledEnd.toLocaleString() : 'Select date/time'}
                </Text>
                <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
              </Pressable>
              {showEndPicker && (
                <DateTimePicker
                  value={formData.scheduledEnd || new Date()}
                  mode="datetime"
                  onChange={(event, date) => {
                    setShowEndPicker(false)
                    if (date) setFormData((prev) => ({ ...prev, scheduledEnd: date }))
                  }}
                />
              )}
            </Card>
          </>
        )}

        <Card style={styles.card}>
          <Text style={styles.label}>Job Site Address</Text>
          <TextInput
            style={styles.input}
            placeholder="Street"
            value={formData.jobSite.street}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, jobSite: { ...prev.jobSite, street: text } }))}
          />
          <View style={styles.addressRow}>
            <TextInput
              style={[styles.input, styles.addressInput]}
              placeholder="City"
              value={formData.jobSite.city}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, jobSite: { ...prev.jobSite, city: text } }))}
            />
            <TextInput
              style={[styles.input, styles.addressInput]}
              placeholder="State"
              value={formData.jobSite.state}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, jobSite: { ...prev.jobSite, state: text } }))}
            />
            <TextInput
              style={[styles.input, styles.addressInput]}
              placeholder="ZIP"
              value={formData.jobSite.zipCode}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, jobSite: { ...prev.jobSite, zipCode: text } }))}
            />
          </View>
        </Card>
      </ScrollView>
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  saveButton: {
    padding: spacing.xs,
  },
  saveButtonText: {
    ...typography.sub,
    color: colors.brandPrimary,
    fontWeight: '600',
  },
  scrollView: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md },
  card: {
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.sub,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  selectContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  selectText: {
    ...typography.sub,
    color: colors.textPrimary,
    flex: 1,
  },
  selectButton: {
    padding: spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  statusChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  statusChipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  statusChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  statusChipTextActive: {
    color: '#E6C98B',
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  dateText: {
    ...typography.sub,
    color: colors.textPrimary,
  },
  addressRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  addressInput: {
    flex: 1,
  },
})
