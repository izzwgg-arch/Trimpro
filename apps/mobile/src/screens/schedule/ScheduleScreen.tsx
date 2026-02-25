import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { ScheduleItem } from '../../types/models'
import { useAuth } from '../../auth/AuthContext'
import { colors, spacing, typography } from '../../theme/tokens'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { SectionHeader } from '../../components/SectionHeader'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { ScheduleStackParamList } from '../../types/navigation'

interface ScheduleResponse {
  schedules: ScheduleItem[]
}

interface TeamMember {
  id: string
  firstName: string
  lastName: string
}

interface TeamMembersResponse {
  teamMembers: TeamMember[]
}

type Props = NativeStackScreenProps<ScheduleStackParamList, 'ScheduleHome'>

export function ScheduleScreen({ navigation }: Props) {
  const { user } = useAuth()
  const { canCreateSchedulesForOthers } = useMobilePermissions()
  const queryClient = useQueryClient()
  const [selectedUserId, setSelectedUserId] = useState<string>('')

  useEffect(() => {
    if (user?.id && !selectedUserId) {
      setSelectedUserId(user.id)
    }
  }, [selectedUserId, user?.id])

  const teamQuery = useQuery({
    queryKey: ['mobile-schedule-team'],
    queryFn: () => apiRequest<TeamMembersResponse>('/api/schedules/team'),
    enabled: canCreateSchedulesForOthers(),
  })

  const targetUserId = useMemo(() => {
    if (!user?.id) return 'all'
    if (!canCreateSchedulesForOthers()) return user.id
    return selectedUserId || user.id
  }, [canCreateSchedulesForOthers, selectedUserId, user?.id])

  const query = useQuery({
    queryKey: ['mobile-schedule', user?.id, targetUserId],
    queryFn: () => apiRequest<ScheduleResponse>(`/api/schedules?view=week&userId=${targetUserId}`),
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
  })

  if (query.isLoading) {
    return (
      <AppScreen>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.brandPrimary} />
          <Text style={styles.loadingText}>Loading schedule...</Text>
        </View>
      </AppScreen>
    )
  }

  if (query.isError) {
    return (
      <AppScreen>
        <EmptyState
          icon="alert-circle-outline"
          title="Schedule failed to load"
          description="Pull to refresh and try again."
        />
      </AppScreen>
    )
  }

  return (
    <AppScreen>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Schedule</Text>
          <Text style={styles.subtitle}>Weekly timeline for your assigned work.</Text>
        </View>
        <Pressable
          style={styles.newButton}
          onPress={() => {
            if (__DEV__) console.debug('[schedule] open create screen')
            navigation.navigate('ScheduleCreate')
          }}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.newButtonText}>New</Text>
        </Pressable>
      </View>
      {canCreateSchedulesForOthers() && (
        <View style={styles.selectorRow}>
          <Text style={styles.selectorLabel}>Employee</Text>
          <FlatList
            horizontal
            data={teamQuery.data?.teamMembers || []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.selectorList}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => {
              const active = (selectedUserId || user?.id) === item.id
              return (
                <Pressable
                  onPress={() => {
                    setSelectedUserId(item.id)
                    void queryClient.invalidateQueries({ queryKey: ['mobile-schedule'] })
                  }}
                  style={[styles.userChip, active && styles.userChipActive]}
                >
                  <Text style={[styles.userChipText, active && styles.userChipTextActive]}>
                    {item.firstName} {item.lastName}
                  </Text>
                </Pressable>
              )
            }}
          />
        </View>
      )}
      <FlatList
        data={query.data?.schedules ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        ListHeaderComponent={<SectionHeader title="This Week" />}
        ListEmptyComponent={
          <EmptyState icon="calendar-outline" title="No schedule items" description="New assignments appear here automatically." />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              if (__DEV__) console.debug('[schedule] open detail', { scheduleId: item.id })
              navigation.navigate('ScheduleDetail', { scheduleId: item.id })
            }}
          >
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>{item.title || 'Untitled schedule'}</Text>
              <Text style={styles.meta}>
                {new Date(item.startTime).toLocaleString()} - {new Date(item.endTime).toLocaleString()}
              </Text>
              <Text style={styles.meta}>{item.job ? `${item.job.jobNumber} - ${item.job.title}` : item.type}</Text>
              {item.user && item.user.id !== user?.id ? (
                <Text style={styles.forUser}>
                  For {item.user.firstName} {item.user.lastName}
                </Text>
              ) : null}
            </Card>
          </Pressable>
        )}
      />
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.sm, paddingBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  newButton: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.brandPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  newButtonText: { ...typography.caption, color: '#fff', fontWeight: '700' },
  selectorRow: { marginBottom: spacing.sm },
  selectorLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: 6 },
  selectorList: { gap: spacing.xs },
  userChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  userChipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  userChipText: { ...typography.caption, color: colors.textPrimary },
  userChipTextActive: { color: '#fff' },
  card: { marginBottom: spacing.sm },
  cardTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '700', marginBottom: 4 },
  meta: { ...typography.caption, color: colors.textSecondary },
  forUser: { ...typography.caption, color: colors.brandPrimary, marginTop: 6, fontWeight: '600' },
})

