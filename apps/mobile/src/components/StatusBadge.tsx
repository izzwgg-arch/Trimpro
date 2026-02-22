import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, radius, spacing, typography } from '../theme/tokens'

function mapStatus(status: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'SCHEDULED') return { bg: 'rgba(37,99,235,0.12)', fg: colors.info, label: 'Scheduled' }
  if (normalized === 'IN_PROGRESS') return { bg: 'rgba(217,119,6,0.14)', fg: '#B45309', label: 'In Progress' }
  if (normalized === 'COMPLETED') return { bg: 'rgba(22,163,74,0.14)', fg: '#15803D', label: 'Completed' }
  if (normalized === 'ON_HOLD' || normalized === 'CANCELLED') {
    return { bg: 'rgba(220,38,38,0.12)', fg: '#B91C1C', label: normalized.replace('_', ' ') }
  }
  return { bg: 'rgba(148,163,184,0.14)', fg: colors.textSecondary, label: normalized.replace('_', ' ') || 'Unknown' }
}

export function StatusBadge({ status }: { status: string }) {
  const token = mapStatus(status)
  return (
    <View style={[styles.badge, { backgroundColor: token.bg }]}>
      <Text style={[styles.text, { color: token.fg }]}>{token.label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  text: {
    ...typography.caption,
    fontWeight: '600',
  },
})

