import React from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { Conversation } from '../../types/models'
import { MessagesStackParamList } from '../../types/navigation'
import { colors, spacing, typography } from '../../theme/tokens'
import { EmptyState } from '../../components/EmptyState'
import { PressableCard } from '../../components/Card'
import { SectionHeader } from '../../components/SectionHeader'

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
    <AppScreen>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Messages</Text>
          <Text style={styles.subtitle}>Client and crew conversations.</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.teamButton, pressed && styles.teamButtonPressed]}
          android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
          onPress={() => navigation.navigate('TeamChat')}
        >
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
        ListHeaderComponent={<SectionHeader title="Recent Conversations" />}
        ListEmptyComponent={<EmptyState icon="chatbubble-ellipses-outline" title="No conversations" description="Messages will show here when available." />}
        renderItem={({ item }) => (
          <PressableCard style={styles.card} onPress={() => navigation.navigate('MessageThread', { conversationId: item.id })}>
            <Text style={styles.cardTitle}>{item.client?.name || item.participants?.[0] || 'Conversation'}</Text>
            <Text style={styles.meta}>{item.messages?.[0]?.body || 'No recent messages'}</Text>
          </PressableCard>
        )}
      />
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  teamButton: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 10,
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  teamButtonPressed: { opacity: 0.9 },
  teamButtonText: {
    color: colors.surface,
    fontWeight: '700',
    fontSize: 12,
  },
  card: { marginBottom: spacing.sm },
  cardTitle: { ...typography.sub, color: colors.textPrimary, fontWeight: '700', marginBottom: 4 },
  meta: { ...typography.caption, color: colors.textSecondary },
})

