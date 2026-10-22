import React, { useEffect, useRef } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { apiRequest } from '../../api/client'
import { colors, radius, spacing, typography } from '../../theme/tokens'

export type JobVisibilityValue = {
  restrictContent: boolean
  attachmentIds: string[]
  noteIds: string[]
}

type ShareOptions = {
  attachments: Array<{ id: string; fileName: string; fileSize: number; mimeType: string }>
  notes: Array<{ id: string; content: string; isJobDescription: boolean }>
}

function formatBytes(bytes: number) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

/**
 * "What can this person see on the job?" — choose the attachments and notes shared
 * with the scheduled person. Renders nothing when the user lacks permission
 * (the parent then gets `null` and sends no visibility fields).
 */
export function JobContentVisibilityPicker({
  jobId,
  value,
  onChange,
  initial,
}: {
  jobId: string
  value: JobVisibilityValue | null
  onChange: (next: JobVisibilityValue | null) => void
  initial?: JobVisibilityValue
}) {
  const query = useQuery({
    queryKey: ['job-share-options', jobId],
    queryFn: () => apiRequest<ShareOptions>(`/api/jobs/${jobId}/share-options`),
    enabled: Boolean(jobId),
    retry: false,
  })
  const initializedFor = useRef<string | null>(null)

  useEffect(() => {
    initializedFor.current = null
    onChange(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  useEffect(() => {
    if (!query.data || initializedFor.current === jobId) return
    initializedFor.current = jobId
    const descriptionIds = query.data.notes.filter((n) => n.isJobDescription).map((n) => n.id)
    onChange(
      initial
        ? { ...initial, noteIds: Array.from(new Set([...initial.noteIds, ...descriptionIds])) }
        : { restrictContent: true, attachmentIds: [], noteIds: descriptionIds }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, jobId])

  if (!jobId || query.isError) return null
  if (query.isLoading || !query.data || !value) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    )
  }

  const { attachments, notes } = query.data

  const Check = ({ checked, disabled }: { checked: boolean; disabled?: boolean }) => (
    <Ionicons
      name={checked ? 'checkbox' : 'square-outline'}
      size={20}
      color={disabled ? colors.muted : checked ? colors.brandPrimary : colors.textSecondary}
    />
  )

  return (
    <View style={styles.box}>
      <Text style={styles.title}>What can this person see on the job?</Text>
      <Text style={styles.sub}>Applies when they open the job from their schedule.</Text>

      <Pressable style={styles.radioRow} onPress={() => onChange({ ...value, restrictContent: false })}>
        <Ionicons name={!value.restrictContent ? 'radio-button-on' : 'radio-button-off'} size={20} color={colors.brandPrimary} />
        <Text style={styles.rowText}>Everything on the job</Text>
      </Pressable>
      <Pressable style={styles.radioRow} onPress={() => onChange({ ...value, restrictContent: true })}>
        <Ionicons name={value.restrictContent ? 'radio-button-on' : 'radio-button-off'} size={20} color={colors.brandPrimary} />
        <Text style={styles.rowText}>Only what I select below</Text>
      </Pressable>

      {value.restrictContent ? (
        <>
          <Text style={styles.groupTitle}>Notes</Text>
          {notes.length === 0 ? <Text style={styles.empty}>This job has no notes.</Text> : null}
          {notes.map((n) => (
            <Pressable
              key={n.id}
              style={styles.checkRow}
              disabled={n.isJobDescription}
              onPress={() => onChange({ ...value, noteIds: toggle(value.noteIds, n.id) })}
            >
              <Check checked={n.isJobDescription || value.noteIds.includes(n.id)} disabled={n.isJobDescription} />
              <Text style={styles.rowText} numberOfLines={2}>
                {n.isJobDescription ? 'Job description (always shared): ' : ''}
                {n.content}
              </Text>
            </Pressable>
          ))}

          <View style={styles.groupHead}>
            <Text style={styles.groupTitle}>Attachments</Text>
            {attachments.length > 0 ? (
              <View style={styles.links}>
                <Pressable onPress={() => onChange({ ...value, attachmentIds: attachments.map((a) => a.id) })} hitSlop={6}>
                  <Text style={styles.link}>Select all</Text>
                </Pressable>
                <Pressable onPress={() => onChange({ ...value, attachmentIds: [] })} hitSlop={6}>
                  <Text style={[styles.link, { color: colors.textSecondary }]}>None</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          {attachments.length === 0 ? <Text style={styles.empty}>This job has no attachments.</Text> : null}
          <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
            {attachments.map((a) => (
              <Pressable
                key={a.id}
                style={styles.checkRow}
                onPress={() => onChange({ ...value, attachmentIds: toggle(value.attachmentIds, a.id) })}
              >
                <Check checked={value.attachmentIds.includes(a.id)} />
                <Text style={[styles.rowText, { flex: 1 }]} numberOfLines={1}>
                  {a.fileName}
                </Text>
                <Text style={styles.size}>{formatBytes(a.fileSize)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  loading: { paddingVertical: spacing.md, alignItems: 'center' },
  box: { marginTop: spacing.md, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  title: { ...typography.sub, color: colors.textPrimary, fontWeight: '700' },
  sub: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  rowText: { ...typography.sub, color: colors.textPrimary, flexShrink: 1 },
  groupTitle: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', marginTop: spacing.sm },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  links: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  link: { ...typography.caption, color: colors.brandPrimary, fontWeight: '700' },
  empty: { ...typography.caption, color: colors.muted },
  size: { ...typography.caption, color: colors.muted },
})
