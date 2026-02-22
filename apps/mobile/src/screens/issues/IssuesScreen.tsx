import React from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { Issue } from '../../types/models'
import { IssuesStackParamList } from '../../types/navigation'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Pressable } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, typography } from '../../theme/tokens'
import { EmptyState } from '../../components/EmptyState'
import { PressableCard } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import { SectionHeader } from '../../components/SectionHeader'

interface IssuesResponse {
  issues: Issue[]
}

type Props = NativeStackScreenProps<IssuesStackParamList, 'IssuesList'>

export function IssuesScreen({ navigation }: Props) {
  const { canCreateIssues, canAssignIssuesToAdmin } = useMobilePermissions()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['mobile-issues'],
    queryFn: () => apiRequest<IssuesResponse>('/api/issues?filter=assigned&limit=100'),
    refetchInterval: 60_000,
  })

  const createIssueMutation = useMutation({
    mutationFn: async () => {
      // Get admin users for assignment
      const usersResponse = await apiRequest<{ users: Array<{ id: string; role: string; firstName: string; lastName: string }> }>(
        '/api/users?role=ADMIN&limit=10'
      )
      const adminUsers = usersResponse.users.filter((u) => u.role === 'ADMIN' || u.role === 'OFFICE')
      
      if (adminUsers.length === 0) {
        throw new Error('No admin users found to assign the issue to.')
      }

      const assigneeId = adminUsers[0].id
      
      return apiRequest('/api/issues?mobile=true', 'POST', {
        title: 'New Issue',
        description: 'Issue created from mobile app',
        assigneeId,
        type: 'OTHER',
        priority: 'MEDIUM',
        status: 'OPEN',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mobile-issues'] })
      queryClient.invalidateQueries({ queryKey: ['mobile-assignments'] })
      Alert.alert('Success', 'Issue created and assigned to admin')
    },
    onError: (error: any) => {
      Alert.alert('Error', error?.message || 'Failed to create issue')
    },
  })

  return (
    <AppScreen>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Issues</Text>
            <Text style={styles.subtitle}>Track open field issues and resolve them quickly.</Text>
          </View>
          {canCreateIssues() && canAssignIssuesToAdmin() && (
            <Pressable
              style={styles.createButton}
              onPress={() => createIssueMutation.mutate()}
              disabled={createIssueMutation.isPending}
            >
              <Ionicons name="add" size={24} color="#E6C98B" />
            </Pressable>
          )}
        </View>
      </View>
      <FlatList
        data={query.data?.issues ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        ListHeaderComponent={<SectionHeader title="Active Issues" />}
        ListEmptyComponent={<EmptyState icon="alert-circle-outline" title="No assigned issues" description="No active issues need attention." />}
        renderItem={({ item }) => (
          <PressableCard
            style={styles.card}
            onPress={() => navigation.navigate('IssueDetail', { issueId: item.id })}
          >
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.meta}>{item.description || 'No description'}</Text>
            <Text style={styles.meta}>Priority: {item.priority}</Text>
          </PressableCard>
        )}
      />
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { marginBottom: spacing.sm },
  cardTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '700', flex: 1, marginRight: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  meta: { ...typography.caption, color: colors.textSecondary },
})

