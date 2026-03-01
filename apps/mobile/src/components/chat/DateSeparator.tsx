import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, spacing, typography } from '../../theme/tokens'

interface DateSeparatorProps {
  date: Date
}

export function DateSeparator({ date }: DateSeparatorProps) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  let label: string
  if (dateOnly.getTime() === today.getTime()) {
    label = 'Today'
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    label = 'Yesterday'
  } else {
    label = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  }

  return (
    <View style={styles.container}>
      <View style={styles.line} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.line} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.divider,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.sm,
    fontWeight: '500',
  },
})
