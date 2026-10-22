import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { apiRequest } from '../../api/client'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { SwipePager } from '../attachments/SwipePager'

export type JobVisibilityValue = {
  restrictContent: boolean
  attachmentIds: string[]
  noteIds: string[]
}

type ShareOptions = {
  attachments: Array<{ id: string; fileName: string; fileSize: number; mimeType: string; url?: string }>
  notes: Array<{ id: string; content: string; isJobDescription: boolean; scheduleId?: string | null }>
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
  // Index into the photos list; swiping in the viewer moves between photos.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
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
    onChange(initial ?? { restrictContent: true, attachmentIds: [], noteIds: [] })
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
  const photos = attachments.filter((a) => String(a.mimeType || '').toLowerCase().startsWith('image/') && Boolean(a.url))

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
          <Text style={styles.empty}>The schedule description is added to the job notes and shared automatically.</Text>
          {notes.length === 0 ? <Text style={styles.empty}>This job has no notes.</Text> : null}
          {notes.map((n) => (
            <Pressable
              key={n.id}
              style={styles.checkRow}
              disabled={Boolean(n.scheduleId)}
              onPress={() => onChange({ ...value, noteIds: toggle(value.noteIds, n.id) })}
            >
              <Check checked={Boolean(n.scheduleId) || value.noteIds.includes(n.id)} disabled={Boolean(n.scheduleId)} />
              <Text style={styles.rowText} numberOfLines={2}>
                {n.isJobDescription ? 'Job description: ' : n.scheduleId ? 'Schedule note (always shared): ' : ''}
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
          <View style={styles.grid}>
            {attachments.map((a) => {
              const selected = value.attachmentIds.includes(a.id)
              const mime = String(a.mimeType || '').toLowerCase()
              const isImage = mime.startsWith('image/') && Boolean(a.url)
              const isVideo = mime.startsWith('video/')
              return (
                <View key={a.id} style={styles.tileWrap}>
                  <Pressable
                    style={[styles.tile, selected && styles.tileSelected]}
                    onPress={() => onChange({ ...value, attachmentIds: toggle(value.attachmentIds, a.id) })}
                  >
                    {isImage ? (
                      <Image source={{ uri: a.url }} style={styles.tileImage} />
                    ) : (
                      <View style={styles.tileIcon}>
                        <Ionicons
                          name={isVideo ? 'videocam-outline' : 'document-text-outline'}
                          size={26}
                          color={colors.textSecondary}
                        />
                        <Text style={styles.tileBadge}>{isVideo ? 'VIDEO' : mime === 'application/pdf' ? 'PDF' : 'FILE'}</Text>
                      </View>
                    )}
                    <View style={styles.tileCheck}>
                      <Check checked={selected} />
                    </View>
                  </Pressable>
                  <Pressable
                    style={styles.tileOpen}
                    hitSlop={6}
                    onPress={() => {
                      if (!a.url) return
                      if (isImage) setPreviewIndex(Math.max(0, photos.findIndex((x) => x.id === a.id)))
                      else Linking.openURL(a.url).catch(() => {})
                    }}
                  >
                    <Ionicons name="expand-outline" size={16} color={colors.textPrimary} />
                  </Pressable>
                  <Text style={styles.tileName} numberOfLines={1}>
                    {a.fileName}
                  </Text>
                </View>
              )
            })}
          </View>
        </>
      ) : null}
      <Modal visible={previewIndex !== null} transparent animationType="fade" onRequestClose={() => setPreviewIndex(null)}>
        <View style={styles.previewBackdrop}>
          {previewIndex !== null && photos.length > 0 ? (
            <SwipePager
              count={photos.length}
              index={previewIndex}
              onIndexChange={setPreviewIndex}
              renderItem={(i) => (
                <View style={styles.previewPage}>
                  <Image source={{ uri: photos[i].url }} style={styles.previewImage} resizeMode="contain" />
                  <Text style={styles.previewName}>
                    {photos[i].fileName} ({i + 1}/{photos.length})
                  </Text>
                </View>
              )}
            />
          ) : null}
          <Pressable style={styles.previewClose} onPress={() => setPreviewIndex(null)} hitSlop={10}>
            <Text style={styles.previewCloseText}>Close</Text>
          </Pressable>
        </View>
      </Modal>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  tileWrap: { width: '31%' },
  tile: { aspectRatio: 1, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.divider, overflow: 'hidden' },
  tileSelected: { borderColor: colors.brandPrimary },
  tileImage: { width: '100%', height: '100%' },
  tileIcon: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tileBadge: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  tileCheck: { position: 'absolute', top: 2, left: 2, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 4 },
  tileOpen: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 4, padding: 2 },
  tileName: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  previewPage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '80%' },
  previewClose: { position: 'absolute', top: 40, right: spacing.md, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  previewCloseText: { ...typography.caption, color: '#fff', fontWeight: '700' },
  previewName: { ...typography.caption, color: '#fff', marginTop: spacing.sm },
})
