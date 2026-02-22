import React from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { Issue } from '../../types/models'
import { MoreStackParamList } from '../../types/navigation'
import { colors, spacing, typography } from '../../theme/tokens'
import { EmptyState } from '../../components/EmptyState'
import { PressableCard } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import { SectionHeader } from '../../components/SectionHeader'

interface IssuesResponse {
  issues: Issue[]
}

type Props = NativeStackScreenProps<MoreStackParamList, 'Issues'>

export function IssuesScreen({ navigation }: Props) {
  const query = useQuery({
    queryKey: ['mobile-issues'],
    queryFn: () => apiRequest<IssuesResponse>('/api/issues?filter=assigned&limit=100'),
    refetchInterval: 60_000,
  })

  return (
    <AppScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Issues</Text>
        <Text style={styles.subtitle}>Track open field issues and resolve them quickly.</Text>
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
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  card: { marginBottom: spacing.sm },
  cardTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '700', flex: 1, marginRight: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  meta: { ...typography.caption, color: colors.textSecondary },
})

