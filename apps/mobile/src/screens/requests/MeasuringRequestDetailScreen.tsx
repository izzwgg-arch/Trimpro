import React from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppScreen } from '../../components/AppScreen'
import { EmptyState } from '../../components/EmptyState'
import { apiRequest } from '../../api/client'
import { JobsStackParamList } from '../../types/navigation'
import { colors, spacing, typography } from '../../theme/tokens'
import { StatusBadge } from '../../components/StatusBadge'

type Props = NativeStackScreenProps<JobsStackParamList, 'MeasuringRequestDetail'>

type MeasuringRequestDetailResponse = {
  measuringRequest: {
    id: string
    status: 'pending' | 'opened' | 'completed'
    notes?: string | null
    createdAt: string
    openedAt?: string | null
    completedAt?: string | null
    request: {
      id: string
      customerName: string
      firstName: string
      lastName: string
      email?: string | null
      phone?: string | null
      company?: string | null
      jobSiteAddress?: string | null
      notes?: string | null
      status: string
      createdAt: string
    }
  }
}

export function MeasuringRequestDetailScreen({ route }: Props) {
  const { measuringRequestId } = route.params
  const queryClient = useQueryClient()
  const didAutoOpenRef = React.useRef(false)

  const query = useQuery({
    queryKey: ['mobile-measuring-request-detail', measuringRequestId],
    queryFn: () => apiRequest<MeasuringRequestDetailResponse>(`/api/measuring-requests/${measuringRequestId}`),
    refetchInterval: 15_000,
  })

  const openMutation = useMutation({
    mutationFn: () => apiRequest(`/api/measuring-requests/${measuringRequestId}/open`, 'PATCH'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-measuring-request-detail', measuringRequestId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-measuring-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-measuring-request-count'] }),
      ])
    },
    onError: () => {
      didAutoOpenRef.current = false
    },
  })

  const completeMutation = useMutation({
    mutationFn: () => apiRequest(`/api/measuring-requests/${measuringRequestId}/complete`, 'PATCH'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-measuring-request-detail', measuringRequestId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-measuring-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-measuring-request-count'] }),
      ])
      Alert.alert('Completed', 'Measuring request marked as completed.')
    },
    onError: (error: any) => {
      Alert.alert('Error', error?.message || 'Unable to complete measuring request.')
    },
  })

  React.useEffect(() => {
    const status = query.data?.measuringRequest?.status
    if (!status || status !== 'pending' || didAutoOpenRef.current || openMutation.isPending) return
    didAutoOpenRef.current = true
    openMutation.mutate()
  }, [openMutation, openMutation.isPending, query.data?.measuringRequest?.status])

  if (query.isLoading) {
    return (
      <AppScreen>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading measuring request...</Text>
        </View>
      </AppScreen>
    )
  }

  if (query.isError || !query.data?.measuringRequest) {
    return (
      <AppScreen>
        <View style={styles.center}>
          <EmptyState icon="alert-circle-outline" title="Unable to load request" description="Please try again." />
          <Pressable style={styles.retryButton} onPress={() => void query.refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </AppScreen>
    )
  }

  const row = query.data.measuringRequest
  const request = row.request

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Request #{request.id}</Text>
            <StatusBadge status={row.status.toUpperCase()} />
          </View>
          <Text style={styles.meta}>Created {new Date(row.createdAt).toLocaleString()}</Text>
          {row.openedAt ? <Text style={styles.meta}>Opened {new Date(row.openedAt).toLocaleString()}</Text> : null}
          {row.completedAt ? <Text style={styles.meta}>Completed {new Date(row.completedAt).toLocaleString()}</Text> : null}
          {row.notes ? <Text style={styles.sectionBody}>{row.notes}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Customer</Text>
          <Text style={styles.sectionBody}>{request.customerName}</Text>
          {request.phone ? <Text style={styles.meta}>Phone: {request.phone}</Text> : null}
          {request.email ? <Text style={styles.meta}>Email: {request.email}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Address</Text>
          <Text style={styles.sectionBody}>{request.jobSiteAddress || 'No address provided'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Request Notes</Text>
          <Text style={styles.sectionBody}>{request.notes || 'No notes'}</Text>
        </View>

        {row.status !== 'completed' ? (
          <Pressable
            style={[styles.completeButton, completeMutation.isPending && styles.completeButtonDisabled]}
            onPress={() => completeMutation.mutate()}
            disabled={completeMutation.isPending}
          >
            <Text style={styles.completeButtonText}>
              {completeMutation.isPending ? 'Saving...' : 'Mark Measuring Completed'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  retryButton: {
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  retryText: {
    ...typography.sub,
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.sm,
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  sectionTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  sectionBody: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  completeButton: {
    borderRadius: 10,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  completeButtonDisabled: {
    opacity: 0.6,
  },
  completeButtonText: {
    ...typography.sub,
    color: '#E6C98B',
    fontWeight: '700',
  },
})
