import React from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { Issue } from '../../types/models'
import { StatusChip } from '../../components/StatusChip'
import { BRAND } from '../../config/env'
import { MoreStackParamList } from '../../types/navigation'

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
    <Screen style={styles.screen}>
      <Text style={styles.title}>Issues</Text>
      <Text style={styles.subtitle}>Track open field issues and close them quickly.</Text>
      <FlatList
        data={query.data?.issues ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        ListEmptyComponent={<Text style={styles.empty}>No issues assigned.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => navigation.navigate('IssueDetail', { issueId: item.id })}
          >
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <StatusChip status={item.status} />
            </View>
            <Text style={styles.meta}>{item.description || 'No description'}</Text>
            <Text style={styles.meta}>Priority: {item.priority}</Text>
          </Pressable>
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14 },
  title: { fontSize: 24, fontWeight: '800', color: BRAND.text, marginBottom: 2 },
  subtitle: { color: BRAND.muted, marginBottom: 12 },
  empty: { textAlign: 'center', color: BRAND.muted, marginTop: 42 },
  card: {
    backgroundColor: BRAND.white,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
    shadowColor: '#101828',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardTitle: { color: BRAND.text, fontWeight: '700', flex: 1, marginRight: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  meta: { color: BRAND.muted, fontSize: 13 },
})

