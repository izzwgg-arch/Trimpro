import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, typography } from '../../theme/tokens'
import { Conversation } from '../../types/models'

interface ConversationRowProps {
  conversation: Conversation
  onPress: () => void
  isSelected?: boolean
}

function displayName(user?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null) {
  if (!user) return 'Unknown'
  const full = `${user.firstName || ''} ${user.lastName || ''}`.trim()
  return full || user.email || 'Unknown'
}

function formatTime(dateString: string | null | undefined): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ConversationRow({ conversation, onPress, isSelected }: ConversationRowProps) {
  const title = conversation.pinned ? 'Team Chat' : conversation.title || displayName(conversation.otherUser)
  const preview = conversation.lastMessage?.text || (conversation.lastMessage ? `[${conversation.lastMessage.type}]` : 'No messages yet')
  const time = formatTime(conversation.lastMessageAt)

  return (
    <Pressable
      style={[styles.row, isSelected && styles.selected]}
      onPress={onPress}
      android_ripple={{ color: 'rgba(15,23,42,0.06)' }}
    >
      <View style={styles.avatar}>
        {conversation.pinned ? (
          <Ionicons name="people" size={20} color={colors.brandPrimary} />
        ) : (
          <View style={styles.avatarInitials}>
            <Text style={styles.avatarText}>{title.charAt(0).toUpperCase()}</Text>
          </View>
        )}
      </View>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {time ? <Text style={styles.time}>{time}</Text> : null}
        </View>
        <View style={styles.footer}>
          <Text style={styles.preview} numberOfLines={1}>
            {preview}
          </Text>
          {conversation.unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  selected: {
    backgroundColor: colors.brandPrimary + '08',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  avatarInitials: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...typography.sub,
    color: colors.surface,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    gap: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  title: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '600',
    flex: 1,
  },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  preview: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  badge: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...typography.caption,
    color: colors.surface,
    fontWeight: '700',
    fontSize: 11,
  },
})
