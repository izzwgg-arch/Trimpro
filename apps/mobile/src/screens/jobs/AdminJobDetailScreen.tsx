import React, { useState } from 'react'
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, Platform } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { StatusBadge } from '../../components/StatusBadge'
import { Card } from '../../components/Card'
import { JobsStackParamList } from '../../types/navigation'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'

type Props = NativeStackScreenProps<JobsStackParamList, 'AdminJobDetail'>

const JOB_STATUS_OPTIONS = [
  'QUOTE',
  'SCHEDULED',
  'IN_PROGRESS',
  'INSTALLATION_COMPLETE',
  'FINISHING_COMPLETE',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
  'INVOICED',
]

function formatStatusLabel(status: string) {
  return status
    .replace('INSTALLATION_COMPLETE', 'INSTALLATION COMPLETED')
    .replace('FINISHING_COMPLETE', 'FINISHING COMPLETED')
    .replaceAll('_', ' ')
}

interface JobResponse {
  job: {
    id: string
    jobNumber: string
    title: string
    description: string | null
    status: string
    priority: number
    scheduledStart: string | null
    scheduledEnd: string | null
    clientId: string
    client: {
      id: string
      name: string
      phone: string | null
    }
    jobSite: {
      street: string
      city: string
      state: string
      zipCode: string
    } | null
    assignments: Array<{
      id: string
      role: string | null
      user: {
        id: string
        firstName: string
        lastName: string
      }
    }>
  }
}

interface AssignmentsResponse {
  assignments: Array<{
    id: string
    role: string | null
    user: {
      id: string
      firstName: string
      lastName: string
      email: string
      phone: string | null
    }
  }>
}

export function AdminJobDetailScreen({ route, navigation }: Props) {
  const { jobId } = route.params
  const queryClient = useQueryClient()
  const { canEditJobs, canAssignJobs, canScheduleJobs, canChangeJobStatus } = useMobilePermissions()
  const [statusPickerVisible, setStatusPickerVisible] = useState(false)

  const jobQuery = useQuery({
    queryKey: ['admin-job', jobId],
    queryFn: () => apiRequest<JobResponse>(`/api/jobs/${jobId}`),
    refetchInterval: 45_000,
  })

  const assignmentsQuery = useQuery({
    queryKey: ['job-assignments', jobId],
    queryFn: () => apiRequest<AssignmentsResponse>(`/api/jobs/${jobId}/assignments`),
  })

  const job = jobQuery.data?.job
  const assignments = assignmentsQuery.data?.assignments ?? []

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      await apiRequest(`/api/jobs/${jobId}`, 'PUT', { status })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-job', jobId] })
      queryClient.invalidateQueries({ queryKey: ['all-jobs'] })
      Alert.alert('Success', 'Job status updated')
    },
    onError: (error: any) => {
      Alert.alert('Error', error?.message || 'Failed to update status')
    },
  })

  if (!job) {
    return (
      <AppScreen>
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>Loading job...</Text>
        </View>
      </AppScreen>
    )
  }

  const address = job.jobSite
    ? `${job.jobSite.street}, ${job.jobSite.city}, ${job.jobSite.state} ${job.jobSite.zipCode}`
    : 'No job site address'

  const openMaps = () => {
    if (!job.jobSite) return
    const fullAddress = `${job.jobSite.street}, ${job.jobSite.city}, ${job.jobSite.state} ${job.jobSite.zipCode}`
    const encoded = encodeURIComponent(fullAddress)
    const googleMapsUrl = Platform.OS === 'android' ? `comgooglemaps://?q=${encoded}` : `googlemaps://?q=${encoded}`
    const webMapsUrl = `https://maps.google.com/?q=${encoded}`
    Linking.canOpenURL(googleMapsUrl)
      .then((supported) => (supported ? Linking.openURL(googleMapsUrl) : Linking.openURL(webMapsUrl)))
      .catch(() => Linking.openURL(webMapsUrl))
  }

  const callClient = () => {
    if (!job.client.phone) {
      Alert.alert('No phone number', 'This client does not have a phone number on file.')
      return
    }
    Linking.openURL(`tel:${job.client.phone}`)
  }

  return (
    <AppScreen>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={styles.jobNumber}>{job.jobNumber}</Text>
              <Text style={styles.jobTitle}>{job.title}</Text>
            </View>
            <StatusBadge status={job.status} />
          </View>
          <Text style={styles.clientName}>{job.client.name}</Text>
          {job.jobSite && (
            <Pressable onPress={openMaps} style={styles.addressRow}>
              <Ionicons name="location-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.addressText}>{address}</Text>
            </Pressable>
          )}
          <View style={styles.actionRow}>
            {job.client.phone && (
              <Pressable style={styles.actionButton} onPress={callClient}>
                <Ionicons name="call-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.actionText}>Call</Text>
              </Pressable>
            )}
            {job.jobSite && (
              <Pressable style={styles.actionButton} onPress={openMaps}>
                <Ionicons name="map-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.actionText}>Maps</Text>
              </Pressable>
            )}
            {canEditJobs() && (
              <Pressable
                style={styles.actionButton}
                onPress={() => navigation.navigate('EditJob', { jobId })}
              >
                <Ionicons name="create-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.actionText}>Edit</Text>
              </Pressable>
            )}
            {canScheduleJobs() && (
              <Pressable
                style={styles.actionButton}
                onPress={() => {
                  const rootNav: any = navigation.getParent()?.getParent() || navigation.getParent()
                  rootNav?.navigate('MainTabs', {
                    screen: 'ScheduleTab',
                    params: {
                      screen: 'ScheduleCreate',
                      params: {
                        jobId: job.id,
                        assignedUserId: assignments[0]?.user?.id,
                        title: `${job.jobNumber} - ${job.title}`,
                      },
                    },
                  })
                }}
              >
                <Ionicons name="calendar-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.actionText}>Schedule</Text>
              </Pressable>
            )}
          </View>
        </Card>

        {canChangeJobStatus() && (
          <Card style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Status</Text>
            <Pressable
              style={styles.statusSelectTrigger}
              onPress={() => setStatusPickerVisible(true)}
              disabled={statusMutation.isPending}
            >
              <Text style={styles.statusSelectValue}>{formatStatusLabel(job.status)}</Text>
              <Ionicons name="chevron-down" size={18} color={colors.textPrimary} />
            </Pressable>
          </Card>
        )}

        {canAssignJobs() && (
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Assigned Crew</Text>
              <Pressable
                style={styles.assignButton}
                onPress={() => {
                  // Navigate to assignment screen (to be implemented)
                  Alert.alert('Assign Crew', 'Assignment screen coming soon')
                }}
              >
                <Ionicons name="person-add-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.assignButtonText}>Assign</Text>
              </Pressable>
            </View>
            {assignments.length === 0 ? (
              <Text style={styles.emptyText}>No crew assigned</Text>
            ) : (
              assignments.map((assignment) => (
                <View key={assignment.id} style={styles.assignmentRow}>
                  <Text style={styles.assignmentName}>
                    {assignment.user.firstName} {assignment.user.lastName}
                  </Text>
                  {assignment.role && <Text style={styles.assignmentRole}>{assignment.role}</Text>}
                </View>
              ))
            )}
          </Card>
        )}

        {job.description && (
          <Card style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.descriptionText}>{job.description}</Text>
          </Card>
        )}

        {job.scheduledStart && (
          <Card style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Schedule</Text>
            <Text style={styles.scheduleText}>
              {new Date(job.scheduledStart).toLocaleString()}
              {job.scheduledEnd && ` - ${new Date(job.scheduledEnd).toLocaleString()}`}
            </Text>
          </Card>
        )}

        <Modal visible={statusPickerVisible} transparent animationType="fade" onRequestClose={() => setStatusPickerVisible(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setStatusPickerVisible(false)} />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Update Job Status</Text>
              <ScrollView style={{ maxHeight: 360 }}>
                {JOB_STATUS_OPTIONS.map((status) => {
                  const active = status === job.status
                  return (
                    <Pressable
                      key={status}
                      style={[styles.modalRow, active && styles.modalRowActive]}
                      onPress={() => {
                        setStatusPickerVisible(false)
                        if (active) return
                        statusMutation.mutate(status)
                      }}
                    >
                      <Text style={styles.modalRowTitle}>{formatStatusLabel(status)}</Text>
                      {active ? <Ionicons name="checkmark" size={18} color={colors.brandPrimary} /> : null}
                    </Pressable>
                  )
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    ...typography.sub,
    color: colors.textSecondary,
  },
  headerCard: {
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  headerText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  jobNumber: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  jobTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  clientName: {
    ...typography.sub,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  addressText: {
    ...typography.caption,
    color: colors.brandPrimary,
    flex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  actionText: {
    ...typography.caption,
    color: colors.brandPrimary,
    fontWeight: '600',
  },
  sectionCard: {
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  statusSelectTrigger: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusSelectValue: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  statusButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  statusButtonActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  statusButtonText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  statusButtonTextActive: {
    color: '#E6C98B',
  },
  assignButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  assignButtonText: {
    ...typography.caption,
    color: colors.brandPrimary,
    fontWeight: '600',
  },
  assignmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  assignmentName: {
    ...typography.sub,
    color: colors.textPrimary,
  },
  assignmentRole: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  emptyText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  descriptionText: {
    ...typography.sub,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  scheduleText: {
    ...typography.sub,
    color: colors.textPrimary,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.45)',
    justifyContent: 'center',
    padding: spacing.md,
  },
  modalCard: {
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.sm,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  modalRow: {
    minHeight: 46,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalRowActive: {
    backgroundColor: 'rgba(15,76,92,0.1)',
  },
  modalRowTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '600',
  },
})
