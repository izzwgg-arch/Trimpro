import React from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { Conversation } from '../../types/models'
import { BRAND } from '../../config/env'
import { MessagesStackParamList } from '../../types/navigation'

interface ConversationsResponse {
  conversations: Conversation[]
}

interface TeamChatSummary {
  conversationId: string
  unreadCount: number
  lastMessageAt: string | null
}

type Props = NativeStackScreenProps<MessagesStackParamList, 'MessagesList'>

export function MessagesScreen({ navigation }: Props) {
  const query = useQuery({
    queryKey: ['mobile-conversations'],
    queryFn: () => apiRequest<ConversationsResponse>('/api/messages/conversations?assigned=me'),
    refetchInterval: 45_000,
  })
  const teamSummaryQuery = useQuery({
    queryKey: ['mobile-team-chat-summary'],
    queryFn: () => apiRequest<TeamChatSummary>('/api/mobile/team-chat?summary=1&markRead=0'),
    refetchInterval: 30_000,
  })

  return (
    <Screen style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Messages</Text>
        <Pressable style={styles.teamButton} onPress={() => navigation.navigate('TeamChat')}>
          <Text style={styles.teamButtonText}>
            Team Chat
            {teamSummaryQuery.data?.unreadCount ? ` (${teamSummaryQuery.data.unreadCount})` : ''}
          </Text>
        </Pressable>
      </View>
      <FlatList
        data={query.data?.conversations ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        ListEmptyComponent={<Text style={styles.empty}>No conversations.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => navigation.navigate('MessageThread', { conversationId: item.id })}>
            <Text style={styles.cardTitle}>{item.client?.name || item.participants?.[0] || 'Conversation'}</Text>
            <Text style={styles.meta}>{item.messages?.[0]?.body || 'No recent messages'}</Text>
          </Pressable>
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 24, fontWeight: '800', color: BRAND.text, marginBottom: 12 },
  teamButton: {
    backgroundColor: BRAND.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  teamButtonText: {
    color: BRAND.white,
    fontWeight: '700',
    fontSize: 12,
  },
  empty: { textAlign: 'center', color: BRAND.muted, marginTop: 42 },
  card: { backgroundColor: BRAND.white, borderRadius: 14, padding: 12, marginBottom: 10 },
  cardTitle: { color: BRAND.text, fontWeight: '700', marginBottom: 4 },
  meta: { color: BRAND.muted, fontSize: 13 },
})

