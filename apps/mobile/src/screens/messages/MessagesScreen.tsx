import React, { useMemo, useState } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Picker } from '@react-native-picker/picker'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { Conversation } from '../../types/models'
import { MessagesStackParamList } from '../../types/navigation'
import { colors, spacing, typography } from '../../theme/tokens'

interface ConversationsResponse {
  conversations: Conversation[]
}

interface UsersResponse {
  users: Array<{
    id: string
    firstName?: string | null
    lastName?: string | null
    email: string
  }>
}

type Props = NativeStackScreenProps<MessagesStackParamList, 'MessagesList'>

function displayName(user?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null) {
  if (!user) return 'Unknown'
  const full = `${user.firstName || ''} ${user.lastName || ''}`.trim()
  return full || user.email || 'Unknown'
}

export function MessagesScreen({ navigation }: Props) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')

  const conversationsQuery = useQuery({
    queryKey: ['mobile-chat-conversations'],
    queryFn: () => apiRequest<ConversationsResponse>('/api/messages/conversations'),
    refetchInterval: 20_000,
  })

  const usersQuery = useQuery({
    queryKey: ['mobile-chat-users'],
    queryFn: () => apiRequest<UsersResponse>('/api/messages/users'),
    refetchInterval: 60_000,
  })

  const createDmMutation = useMutation({
    mutationFn: async (userId: string) => apiRequest<{ conversationId: string }>('/api/messages/dm', 'POST', { userId }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['mobile-chat-conversations'] })
      navigation.navigate('MessageThread', { conversationId: result.conversationId })
    },
    onError: (error: any) => {
      Alert.alert('Error', error?.message || 'Failed to start direct message')
    },
  })

  const teamEnsureMutation = useMutation({
    mutationFn: async () => apiRequest<{ conversationId: string }>('/api/messages/team/ensure', 'POST', {}),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['mobile-chat-conversations'] })
      navigation.navigate('MessageThread', { conversationId: result.conversationId })
    },
  })

  const filtered = useMemo(() => {
    const rows = conversationsQuery.data?.conversations || []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      const title = String(row.title || displayName(row.otherUser) || '').toLowerCase()
      const preview = String(row.lastMessage?.text || '').toLowerCase()
      return title.includes(q) || preview.includes(q)
    })
  }, [conversationsQuery.data?.conversations, search])

  const userOptions = useMemo(() => usersQuery.data?.users || [], [usersQuery.data?.users])

  return (
    <AppScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtitle}>Team and direct conversations.</Text>
      </View>

      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        placeholder="Search conversations..."
        placeholderTextColor={colors.textSecondary}
      />

      <View style={styles.newMessageBox}>
        <Pressable style={styles.teamButton} onPress={() => teamEnsureMutation.mutate()}>
          <Text style={styles.teamButtonText}>Open Team Chat</Text>
        </Pressable>
        <View style={styles.pickerWrap}>
          <Picker selectedValue={selectedUserId} onValueChange={(value) => setSelectedUserId(String(value || ''))} style={styles.picker}>
            <Picker.Item label="Start direct message..." value="" />
            {userOptions.map((user) => (
              <Picker.Item key={user.id} label={displayName(user)} value={user.id} />
            ))}
          </Picker>
        </View>
        <Pressable
          style={[styles.startDmButton, (!selectedUserId || createDmMutation.isPending) && styles.disabledButton]}
          disabled={!selectedUserId || createDmMutation.isPending}
          onPress={() => createDmMutation.mutate(selectedUserId)}
        >
          <Text style={styles.startDmButtonText}>Start DM</Text>
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={conversationsQuery.isRefetching}
            onRefresh={() => conversationsQuery.refetch()}
          />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => navigation.navigate('MessageThread', { conversationId: item.id })}>
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.pinned ? 'Pinned • ' : ''}
                {item.title || displayName(item.otherUser)}
              </Text>
              {item.unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {item.lastMessage?.text || (item.lastMessage ? `[${item.lastMessage.type}]` : 'No messages yet')}
            </Text>
          </Pressable>
        )}
      />
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  newMessageBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.sm,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  teamButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  teamButtonText: {
    color: colors.white,
    fontWeight: '700',
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  picker: {
    height: 44,
    color: colors.textPrimary,
  },
  startDmButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startDmButtonText: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  disabledButton: { opacity: 0.5 },
  listContent: { paddingBottom: 28, gap: spacing.sm },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    flex: 1,
    fontWeight: '700',
  },
  cardMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  unreadBadge: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
})
