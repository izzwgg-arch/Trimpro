import React, { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { apiRequest } from '../../api/client'
import { DetailSection } from '../DetailSection'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import type { TakeoffResponse, TakeoffSummary } from '../../lib/takeoffs'

/** "Material Takeoff" on a job: open one, or start one. */
export function JobTakeoffsSection({ jobId, onOpen }: { jobId: string; onOpen: (takeoffId: string) => void }) {
  const queryClient = useQueryClient()
  const { canViewTakeoffs, canCreateTakeoffs } = useMobilePermissions()
  const [creating, setCreating] = useState(false)
  const enabled = canViewTakeoffs()

  const query = useQuery({
    queryKey: ['job-takeoffs', jobId],
    queryFn: () => apiRequest<{ takeoffs: TakeoffSummary[] }>(`/api/jobs/${jobId}/takeoffs`),
    enabled,
  })

  if (!enabled) return null
  const rows = query.data?.takeoffs || []

  const create = async () => {
    setCreating(true)
    try {
      const res = await apiRequest<TakeoffResponse>(`/api/jobs/${jobId}/takeoffs`, 'POST', {})
      queryClient.invalidateQueries({ queryKey: ['job-takeoffs', jobId] })
      onOpen(res.takeoff.id)
    } catch (error: any) {
      Alert.alert('Could not start a takeoff', error?.message || 'Try again.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <DetailSection
      title="Material Takeoff"
      right={
        canCreateTakeoffs() ? (
          <Pressable style={styles.startBtn} onPress={create} disabled={creating}>
            {creating ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Ionicons name="add" size={18} color={colors.brandPrimary} />}
            <Text style={styles.startText}>{rows.length > 0 ? 'New' : 'Start'}</Text>
          </Pressable>
        ) : undefined
      }
    >
      {query.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : null}
      {!query.isLoading && rows.length === 0 ? <Text style={styles.empty}>No takeoff for this job yet.</Text> : null}
      {rows.map((r, i) => (
        <Pressable key={r.id} style={styles.row} onPress={() => onOpen(r.id)}>
          <Ionicons name="clipboard-outline" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{r.title || `Takeoff ${i + 1}`}</Text>
            <Text style={styles.rowMeta}>
              {r.doorCount} door{r.doorCount === 1 ? '' : 's'} · {r.itemCount} material{r.itemCount === 1 ? '' : 's'} · updated{' '}
              {new Date(r.updatedAt).toLocaleDateString()}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      ))}
    </DetailSection>
  )
}

const styles = StyleSheet.create({
  startBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: spacing.sm },
  startText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 15 },
  empty: { ...typography.caption, color: colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    marginTop: spacing.xs,
  },
  rowTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textSecondary },
})
