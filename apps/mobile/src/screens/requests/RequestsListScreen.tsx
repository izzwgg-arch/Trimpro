import React, { useMemo } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useInfiniteQuery } from '@tanstack/react-query'
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
  const query = useInfiniteQuery({
    queryKey: ['mobile-requests-list'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiRequest<RequestsListResponse>(`/api/leads?page=${pageParam}&limit=20`),
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination
      return page < totalPages ? page + 1 : undefined
    },
  })

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
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
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
            <Text style={styles.requestName}>
              {item.firstName} {item.lastName}
            </Text>
            <Text style={styles.requestMeta}>
              {item.status} • {new Date(item.createdAt).toLocaleDateString()}
            </Text>
            {item.notes ? (
              <Text numberOfLines={2} style={styles.requestNotes}>
                {item.notes}
              </Text>
            ) : null}
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
  requestName: {
    ...typography.sub,
    color: colors.textPrimary,
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
