import React from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, typography } from '../../../theme/tokens'

interface Props {
  title: string
  isTeamChat: boolean
  avatarUri?: string | null
  onBack: () => void
}

export function MessageThreadHeaderV2({ title, isTeamChat, avatarUri, onBack }: Props) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
      </Pressable>
      {!isTeamChat && avatarUri ? <Image source={{ uri: avatarUri }} style={styles.headerAvatar} /> : null}
      <View style={styles.headerContent}>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  backButton: {
    padding: spacing.xs,
    marginRight: spacing.xs,
  },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: spacing.xs,
  },
  headerContent: {
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
})
