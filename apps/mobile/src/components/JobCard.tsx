import React from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Job } from '../types/models'
import { colors, spacing, typography } from '../theme/tokens'
import { PressableCard } from './Card'
import { StatusBadge } from './StatusBadge'

export function JobCard({
  job,
  onPress,
  hasUnreadMessages,
  hasNewMedia,
  hasOpenIssue,
}: {
  job: Job
  onPress: () => void
  hasUnreadMessages?: boolean
  hasNewMedia?: boolean
  hasOpenIssue?: boolean
}) {
  const scheduleText = job.scheduledStart
    ? new Date(job.scheduledStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'No schedule'

  const address = job.address?.street
    ? `${job.address.street}, ${job.address.city || ''} ${job.address.state || ''}`.trim()
    : 'No job site address'

  return (
    <PressableCard onPress={onPress}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Text style={styles.jobTitle} numberOfLines={1}>
            {job.jobNumber} - {job.title}
          </Text>
          <Text style={styles.client} numberOfLines={1}>
            {job.client?.name || 'No client'}
          </Text>
        </View>
        <StatusBadge status={job.status} />
      </View>

      <Text style={styles.meta} numberOfLines={1}>
        {scheduleText}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {address}
      </Text>

      <View style={styles.iconRow}>
        <IconDot name="chatbubble-ellipses-outline" active={Boolean(hasUnreadMessages)} />
        <IconDot name="images-outline" active={Boolean(hasNewMedia)} />
        <IconDot name="alert-circle-outline" active={Boolean(hasOpenIssue)} danger />
      </View>
    </PressableCard>
  )
}

function IconDot({
  name,
  active,
  danger,
}: {
  name: keyof typeof Ionicons.glyphMap
  active: boolean
  danger?: boolean
}) {
  const color = active ? (danger ? '#B42318' : colors.brandPrimary) : colors.muted
  return (
    <Pressable disabled style={styles.iconPill}>
      <Ionicons name={name} size={14} color={color} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  jobTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  client: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  iconRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconPill: {
    minHeight: 24,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

