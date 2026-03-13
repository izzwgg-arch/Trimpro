import React, { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppScreen } from '../../components/AppScreen'
import { EmptyState } from '../../components/EmptyState'
import { apiRequest } from '../../api/client'
import { JobsStackParamList } from '../../types/navigation'
import { colors, spacing, typography } from '../../theme/tokens'

type Props = NativeStackScreenProps<JobsStackParamList, 'RequestsHome'>

interface MobileRequestListItem {
  id: string
  firstName: string
  lastName: string
  status: string
  isUrgent?: boolean
  notes?: string | null
  createdAt: string
}

interface RequestsListResponse {
  leads: MobileRequestListItem[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export function RequestsListScreen({ navigation }: Props) {
  const queryClient = useQueryClient()
  const [isPullRefreshing, setIsPullRefreshing] = useState(false)
  const query = useInfiniteQuery({
    queryKey: ['mobile-requests-list'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiRequest<RequestsListResponse>(`/api/leads?page=${pageParam}&limit=20`),
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination
      return page < totalPages ? page + 1 : undefined
    },
  })
  const urgentMutation = useMutation({
    mutationFn: ({ requestId, isUrgent }: { requestId: string; isUrgent: boolean }) =>
      apiRequest<{ lead: MobileRequestListItem }>(`/api/requests/${requestId}/urgent`, 'PATCH', { isUrgent }),
    onSuccess: (result) => {
      const request = result?.lead
      if (!request?.id) return
      queryClient.setQueryData<InfiniteData<RequestsListResponse>>(['mobile-requests-list'], (existing) => {
        if (!existing) return existing
        return {
          ...existing,
          pages: existing.pages.map((page) => ({
            ...page,
            leads: (page.leads || []).map((lead) => (lead.id === request.id ? { ...lead, isUrgent: request.isUrgent } : lead)),
          })),
        }
      })
      queryClient.setQueryData<{ lead: { id: string; isUrgent?: boolean } }>(
        ['mobile-request-detail', request.id],
        (existing) =>
          existing?.lead
            ? {
                ...existing,
                lead: {
                  ...existing.lead,
                  isUrgent: request.isUrgent,
                },
              }
            : existing
      )
    },
  })

  useFocusEffect(
    React.useCallback(() => {
      void query.refetch()
      return () => {}
    }, [query.refetch])
  )

  const handlePullRefresh = React.useCallback(async () => {
    setIsPullRefreshing(true)
    try {
      await query.refetch()
    } finally {
      setIsPullRefreshing(false)
    }
  }, [query.refetch])

  const requests = useMemo(
    () => (query.data?.pages || []).flatMap((page) => page.leads || []),
    [query.data]
  )

  if (query.isLoading && requests.length === 0) {
    return (
      <AppScreen>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.brandPrimary} />
          <Text style={styles.loadingText}>Loading requests...</Text>
        </View>
      </AppScreen>
    )
  }

  if (query.isError && requests.length === 0) {
    return (
      <AppScreen>
        <View style={styles.loadingWrap}>
          <EmptyState
            icon="alert-circle-outline"
            title="Failed to load requests"
            description="Please try again."
          />
          <Pressable style={styles.retryButton} onPress={() => void query.refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </AppScreen>
    )
  }

  return (
    <AppScreen>
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={() => void handlePullRefresh()}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Requests</Text>
            <Pressable
              style={styles.newButton}
              onPress={() => navigation.navigate('RequestCreate')}
            >
              <Text style={styles.newButtonText}>New Request</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="document-text-outline"
            title="No requests yet"
            description="Create a request to get started."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.requestCard}
            onPress={() => navigation.navigate('RequestDetail', { requestId: item.id })}
          >
            <View style={styles.requestHeadRow}>
              <Text style={styles.requestName}>
                {item.firstName} {item.lastName}
              </Text>
              {item.isUrgent ? <Text style={styles.urgentBadge}>URGENT</Text> : null}
            </View>
            <Text style={styles.requestMeta}>
              {item.status} • {new Date(item.createdAt).toLocaleDateString()}
            </Text>
            {item.notes ? (
              <Text numberOfLines={2} style={styles.requestNotes}>
                {item.notes}
              </Text>
            ) : null}
            <View style={styles.requestActionRow}>
              <Pressable
                style={[styles.urgentButton, item.isUrgent && styles.urgentButtonActive]}
                onPress={(event) => {
                  event.stopPropagation?.()
                  urgentMutation.mutate({ requestId: item.id, isUrgent: !item.isUrgent })
                }}
              >
                <Text style={[styles.urgentButtonText, item.isUrgent && styles.urgentButtonTextActive]}>
                  {item.isUrgent ? 'Unmark Urgent' : 'Mark Urgent'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          query.hasNextPage ? (
            <Pressable
              style={styles.loadMoreButton}
              onPress={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              <Text style={styles.loadMoreText}>
                {query.isFetchingNextPage ? 'Loading...' : 'Load more'}
              </Text>
            </Pressable>
          ) : null
        }
      />
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  loadingWrap: {
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
    marginTop: spacing.sm,
    backgroundColor: colors.brandPrimary,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryText: {
    ...typography.sub,
    color: colors.surface,
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  newButton: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  newButtonText: {
    ...typography.sub,
    color: colors.surface,
    fontWeight: '600',
  },
  requestCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.md,
  },
  requestHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  requestName: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  urgentBadge: {
    ...typography.caption,
    color: '#B91C1C',
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontWeight: '700',
  },
  requestMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  requestNotes: {
    ...typography.caption,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  requestActionRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  urgentButton: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  urgentButtonActive: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  urgentButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  urgentButtonTextActive: {
    color: '#B91C1C',
  },
  loadMoreButton: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  loadMoreText: {
    ...typography.sub,
    color: colors.textPrimary,
  },
})
