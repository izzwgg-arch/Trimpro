import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Ionicons } from '@expo/vector-icons'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { AppScreen } from '../../components/AppScreen'
import { apiRequest } from '../../api/client'
import { colors, radius, spacing, typography } from '../../theme/tokens'
import { EmptyState } from '../../components/EmptyState'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'
import { ScheduleStackParamList } from '../../types/navigation'
import { AttachmentGalleryModal } from '../../components/attachments/AttachmentGalleryModal'
import { callPhone } from '../../lib/phone'
import {
  pickAttachmentsByAction,
  uploadFileWithProgress,
  type AttachmentPickAction,
  type LocalAttachmentFile,
} from '../../services/attachment-upload'

type Props = NativeStackScreenProps<ScheduleStackParamList, 'ScheduleDetail'>

type WorkStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED'
type Work = {
  status: WorkStatus
  startedAt: string | null
  finishedAt: string | null
  completionNotes: string | null
  activeSeconds: number
  runningSince: string | null
  segments: Array<{ startedAt: string | null; endedAt: string | null }>
}

interface DetailsResponse {
  schedule: {
    id: string
    title: string
    type: string
    startTime: string
    endTime: string
    allDay: boolean
    instructions: string
    worker: { id: string; name: string; phone: string | null }
  }
  job: { id: string; jobNumber: string; title: string; status: string; siteAddress: string } | null
  customer: { name: string; phone: string | null; contactName: string | null } | null
  siteManagers: Array<{ id: string; name: string; phone: string | null }>
  notes: Array<{ id: string; content: string; createdAt: string }>
  attachments: Array<{ id: string; fileName: string; mimeType: string; fileSize: number; url: string }>
  work: Work
  canWork: boolean
  canManage: boolean
}

const STATUS_LABEL: Record<WorkStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
}
const STATUS_COLOR: Record<WorkStatus, string> = {
  NOT_STARTED: colors.muted,
  IN_PROGRESS: colors.success,
  PAUSED: colors.warning,
  COMPLETED: colors.info,
}

function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${h}:${pad(m)}:${pad(sec)}`
}

function formatWhen(startIso: string, endIso: string, allDay: boolean) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const day = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  if (allDay) return `${day} · All day`
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${t(start)} – ${t(end)}`
}

export function ScheduleDetailScreen({ navigation, route }: Props) {
  const { scheduleId } = route.params
  const { canCreateSchedulesForOthers, canAssignJobs } = useMobilePermissions()
  const queryClient = useQueryClient()
  const [fetchedAt, setFetchedAt] = useState(Date.now())
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)
  const [finishNotes, setFinishNotes] = useState('')
  const [finishMedia, setFinishMedia] = useState<LocalAttachmentFile[]>([])
  const [uploadProgress, setUploadProgress] = useState<{ index: number; progress: number } | null>(null)
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)

  const detailQuery = useQuery({
    queryKey: ['mobile-schedule-details', scheduleId],
    queryFn: async () => {
      const res = await apiRequest<DetailsResponse>(`/api/schedules/${scheduleId}/details`)
      setFetchedAt(Date.now())
      return res
    },
    refetchInterval: 60_000,
  })
  const data = detailQuery.data
  const work = data?.work

  // Count up locally between refreshes while the visit is running.
  useEffect(() => {
    if (work?.status !== 'IN_PROGRESS') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [work?.status])
  const activeSeconds = work
    ? work.activeSeconds + (work.status === 'IN_PROGRESS' ? Math.max(0, (now - fetchedAt) / 1000) : 0)
    : 0

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest<{ message: string }>(`/api/schedules/${scheduleId}`, 'DELETE'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-schedule'] })
      Alert.alert('Deleted', 'Schedule deleted successfully.')
      navigation.navigate('ScheduleHome')
    },
    onError: (error: any) => Alert.alert('Delete failed', error?.message || 'Unable to delete this schedule.'),
  })

  const canEditSchedule = Boolean(data?.canManage || canCreateSchedulesForOthers() || canAssignJobs())
  const confirmDelete = () =>
    Alert.alert('Delete schedule', 'Are you sure you want to delete this schedule?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ])

  useLayoutEffect(() => {
    if (!canEditSchedule || !data) {
      navigation.setOptions({ headerRight: undefined })
      return
    }
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() =>
            Alert.alert('Schedule actions', undefined, [
              { text: 'Edit', onPress: () => navigation.navigate('ScheduleCreate', { scheduleId }) },
              { text: 'Delete', style: 'destructive', onPress: confirmDelete },
              { text: 'Cancel', style: 'cancel' },
            ])
          }
          style={styles.headerMenuButton}
        >
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textPrimary} />
        </Pressable>
      ),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditSchedule, navigation, data, scheduleId])

  const runAction = async (action: 'start' | 'pause' | 'resume' | 'finish', completionNotes?: string) => {
    setBusy(true)
    try {
      const res = await apiRequest<{ work: Work }>(`/api/schedules/${scheduleId}/work`, 'POST', { action, completionNotes })
      queryClient.setQueryData<DetailsResponse>(['mobile-schedule-details', scheduleId], (old) => (old ? { ...old, work: res.work } : old))
      setFetchedAt(Date.now())
      setNow(Date.now())
      void queryClient.invalidateQueries({ queryKey: ['mobile-schedule'] })
      return true
    } catch (error: any) {
      Alert.alert('Could not update', error?.message || 'Check your connection and try again.')
      void detailQuery.refetch()
      return false
    } finally {
      setBusy(false)
    }
  }

  // Photos and videos from the finish panel go straight onto the job's files.
  const addFinishMedia = async (action: AttachmentPickAction) => {
    try {
      const picked = await pickAttachmentsByAction(action)
      if (picked.length) setFinishMedia((prev) => [...prev, ...picked])
    } catch (error: any) {
      Alert.alert('Could not add file', error?.message || 'Try again.')
    }
  }

  const closeFinish = () => {
    setFinishOpen(false)
    setFinishNotes('')
    setFinishMedia([])
  }

  const confirmFinish = async () => {
    if (!data?.job) return
    setBusy(true)
    const remaining = [...finishMedia]
    try {
      for (let i = 0; i < finishMedia.length; i++) {
        setUploadProgress({ index: i, progress: 0 })
        await uploadFileWithProgress(`/api/jobs/${data.job.id}/attachments`, finishMedia[i], (progress) =>
          setUploadProgress({ index: i, progress })
        ).promise
        remaining.shift()
      }
    } catch (error: any) {
      // Keep only what didn't upload, so a retry doesn't add duplicates.
      setFinishMedia(remaining)
      setBusy(false)
      setUploadProgress(null)
      return Alert.alert('Files not saved', error?.message || 'Try again, or remove the files and finish without them.')
    }
    setUploadProgress(null)
    setFinishMedia([])
    void queryClient.invalidateQueries({ queryKey: ['mobile-schedule-details', scheduleId] })
    const ok = await runAction('finish', finishNotes.trim() || undefined)
    if (ok) closeFinish()
  }

  const openMaps = (address: string) => {
    const q = encodeURIComponent(address)
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`).catch(() =>
      Alert.alert('Cannot open maps', address)
    )
  }

  const messageUser = async (userId: string) => {
    try {
      const dm = await apiRequest<{ conversationId: string }>('/api/messages/dm', 'POST', { userId })
      const parentNav: any = navigation.getParent()
      parentNav?.navigate('MainTabs', {
        screen: 'MessagesTab',
        params: {
          screen: 'MessageThread',
          params: {
            conversationId: dm.conversationId,
            jobContext: data?.job ? { jobId: data.job.id, jobNumber: data.job.jobNumber, jobName: data.job.title } : undefined,
          },
        },
      })
    } catch (error: any) {
      Alert.alert('Could not open chat', error?.message || 'Try again.')
    }
  }

  const contactManager = () => {
    const managers = data?.siteManagers || []
    if (managers.length === 0) return Alert.alert('No site manager', 'This job has no site manager yet.')
    const m = managers[0]
    const buttons: any[] = []
    if (m.phone) buttons.push({ text: `Call ${m.name}`, onPress: () => callPhone(m.phone) })
    buttons.push({ text: `Message ${m.name}`, onPress: () => void messageUser(m.id) })
    for (const other of managers.slice(1)) buttons.push({ text: `Message ${other.name}`, onPress: () => void messageUser(other.id) })
    buttons.push({ text: 'Cancel', style: 'cancel' })
    Alert.alert('Contact site manager', undefined, buttons)
  }

  const gallery = useMemo(
    () => (data?.attachments || []).map((a) => ({ id: a.id, fileName: a.fileName, fileSize: a.fileSize, mimeType: a.mimeType, url: a.url })),
    [data?.attachments]
  )

  if (detailQuery.isLoading) {
    return (
      <AppScreen>
        <EmptyState icon="calendar-outline" title="Loading schedule..." description="Please wait." />
      </AppScreen>
    )
  }
  if (detailQuery.isError || !data) {
    return (
      <AppScreen>
        <EmptyState icon="alert-circle-outline" title="Schedule unavailable" description="This schedule could not be loaded." />
      </AppScreen>
    )
  }

  const { schedule, job, customer, siteManagers, notes, attachments } = data
  const status = work!.status

  return (
    <View style={styles.screen}>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} bottomOffset={spacing.lg} keyboardShouldPersistTaps="handled">
        {/* Visit header */}
        <View style={styles.card}>
          <Text style={styles.title}>{schedule.title || 'Visit'}</Text>
          <Text style={styles.when}>{formatWhen(schedule.startTime, schedule.endTime, schedule.allDay)}</Text>
          {job ? (
            <Pressable
              style={styles.jobLink}
              onPress={() =>
                (navigation.getParent() as any)?.navigate('MainTabs', {
                  screen: 'JobsTab',
                  params: { screen: 'JobDetail', params: { jobId: job.id, scheduleId: schedule.id } },
                })
              }
            >
              <Text style={styles.jobLinkText}>
                {job.jobNumber} · {job.title}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.brandPrimary} />
            </Pressable>
          ) : null}
          {!data.canWork ? <Text style={styles.meta}>Assigned to {schedule.worker.name}</Text> : null}
        </View>

        {/* Work: status, timer and controls */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Work</Text>
            <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[status] }]}>
              <Text style={styles.statusPillText}>{STATUS_LABEL[status]}</Text>
            </View>
          </View>
          {status !== 'NOT_STARTED' ? (
            <Text style={styles.timer}>{formatClock(activeSeconds)}</Text>
          ) : null}
          {status !== 'NOT_STARTED' ? <Text style={styles.meta}>Active time (pauses not counted)</Text> : null}
          {work!.finishedAt ? <Text style={styles.meta}>Finished {new Date(work!.finishedAt).toLocaleString()}</Text> : null}
          {work!.completionNotes ? <Text style={styles.completion}>{work!.completionNotes}</Text> : null}

          {data.canWork && status !== 'COMPLETED' && !finishOpen ? (
            <View style={styles.controls}>
              {status === 'NOT_STARTED' ? (
                <WorkButton icon="play" label="Start Job" color={colors.success} disabled={busy} onPress={() => runAction('start')} />
              ) : null}
              {status === 'IN_PROGRESS' ? (
                <WorkButton icon="pause" label="Pause" color={colors.warning} disabled={busy} onPress={() => runAction('pause')} />
              ) : null}
              {status === 'PAUSED' ? (
                <WorkButton icon="play" label="Resume" color={colors.success} disabled={busy} onPress={() => runAction('resume')} />
              ) : null}
              {status === 'IN_PROGRESS' || status === 'PAUSED' ? (
                <WorkButton icon="checkmark-done" label="Finish Job" color={colors.info} disabled={busy} onPress={() => setFinishOpen(true)} />
              ) : null}
            </View>
          ) : null}
          {!job ? <Text style={styles.meta}>This schedule is not linked to a job, so time can't be tracked.</Text> : null}

          {/* Finish: confirm first (kept at the top so it's always reachable), then notes and media */}
          {finishOpen && status !== 'COMPLETED' ? (
            <View style={styles.finishPanel}>
              <Text style={styles.sectionTitle}>Finish this job?</Text>
              <Text style={styles.meta}>Active time: {formatClock(activeSeconds)}. This can't be undone.</Text>
              <View style={styles.rowGap}>
                <Pressable style={styles.cancelBtn} onPress={closeFinish} disabled={busy}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.finishBtn, busy && { opacity: 0.6 }]} onPress={confirmFinish} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.finishText}>Finish Job</Text>}
                </Pressable>
              </View>
              {uploadProgress ? (
                <Text style={styles.meta}>
                  Uploading {uploadProgress.index + 1} of {finishMedia.length} · {Math.round(uploadProgress.progress * 100)}%
                </Text>
              ) : null}

              <Text style={[styles.label, { marginTop: spacing.sm }]}>Completion notes</Text>
              <TextInput
                style={styles.input}
                value={finishNotes}
                onChangeText={setFinishNotes}
                placeholder="What was done, anything left open…"
                placeholderTextColor={colors.muted}
                multiline
                editable={!busy}
              />

              <Text style={[styles.label, { marginTop: spacing.sm }]}>Photos & videos</Text>
              <View style={styles.rowGap}>
                <MediaButton icon="camera" label="Take photo" disabled={busy} onPress={() => addFinishMedia('take-photo')} />
                <MediaButton icon="videocam" label="Record video" disabled={busy} onPress={() => addFinishMedia('record-video')} />
              </View>
              <View style={styles.rowGap}>
                <MediaButton icon="images" label="Photos" disabled={busy} onPress={() => addFinishMedia('choose-photos')} />
                <MediaButton icon="film" label="Videos" disabled={busy} onPress={() => addFinishMedia('choose-videos')} />
              </View>
              {finishMedia.length > 0 ? (
                <>
                  <ScrollView horizontal style={styles.thumbRow} keyboardShouldPersistTaps="handled">
                    {finishMedia.map((file, i) => (
                      <View key={file.localId} style={styles.finishThumbWrap}>
                        {file.kind === 'image' ? (
                          <Image source={{ uri: file.uri }} style={styles.finishThumb} />
                        ) : (
                          <View style={[styles.finishThumb, styles.videoThumb]}>
                            <Ionicons name="videocam" size={26} color="#fff" />
                            <Text style={styles.videoThumbText}>Video</Text>
                          </View>
                        )}
                        {!busy ? (
                          <Pressable
                            style={styles.removeThumb}
                            onPress={() => setFinishMedia((prev) => prev.filter((_, j) => j !== i))}
                            hitSlop={8}
                            accessibilityLabel="Remove"
                          >
                            <Ionicons name="close" size={14} color="#fff" />
                          </Pressable>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                  <Text style={styles.meta}>
                    {finishMedia.length} file{finishMedia.length === 1 ? '' : 's'} will be added to the job when you finish.
                  </Text>
                </>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Customer and site */}
        {customer || job?.siteAddress ? (
          <View style={styles.card}>
            {customer ? (
              <>
                <Text style={styles.label}>Customer</Text>
                <Text style={styles.big}>{customer.name}</Text>
                {customer.contactName ? <Text style={styles.meta}>{customer.contactName}</Text> : null}
                {customer.phone ? <Text style={styles.meta}>{customer.phone}</Text> : null}
              </>
            ) : null}
            {job?.siteAddress ? (
              <>
                <Text style={[styles.label, { marginTop: spacing.sm }]}>Job site</Text>
                <Text style={styles.big}>{job.siteAddress}</Text>
              </>
            ) : null}
            <View style={styles.actions}>
              {customer?.phone ? (
                <ActionButton icon="call" label="Call Customer" onPress={() => callPhone(customer.phone)} />
              ) : null}
              {job?.siteAddress ? <ActionButton icon="navigate" label="Navigate" onPress={() => openMaps(job.siteAddress)} /> : null}
              {siteManagers.length > 0 ? <ActionButton icon="person" label="Site Manager" onPress={contactManager} /> : null}
            </View>
          </View>
        ) : null}

        {/* Site manager */}
        {siteManagers.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.label}>Site manager</Text>
            {siteManagers.map((m) => (
              <View key={m.id} style={styles.managerRow}>
                <Text style={[styles.big, { flex: 1 }]}>{m.name}</Text>
                {m.phone ? (
                  <Pressable style={styles.iconBtn} onPress={() => callPhone(m.phone)} accessibilityLabel={`Call ${m.name}`}>
                    <Ionicons name="call" size={20} color={colors.brandPrimary} />
                  </Pressable>
                ) : null}
                <Pressable style={styles.iconBtn} onPress={() => void messageUser(m.id)} accessibilityLabel={`Message ${m.name}`}>
                  <Ionicons name="chatbubble-ellipses" size={20} color={colors.brandPrimary} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {/* Instructions and notes */}
        <View style={[styles.card, styles.instructionsCard]}>
          <Text style={styles.instructionsTitle}>Work instructions</Text>
          <Text style={styles.instructions}>{schedule.instructions || 'No instructions added.'}</Text>
        </View>
        {notes.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.label}>Notes</Text>
            {notes.map((n) => (
              <Text key={n.id} style={styles.note}>
                {n.content}
              </Text>
            ))}
          </View>
        ) : null}

        {/* Attachments chosen for this visit */}
        <View style={styles.card}>
          <Text style={styles.label}>Attachments ({attachments.length})</Text>
          {attachments.length === 0 ? <Text style={styles.meta}>No attachments for this visit.</Text> : null}
          <View style={styles.grid}>
            {attachments.map((a, i) => {
              const isImage = String(a.mimeType || '').toLowerCase().startsWith('image/')
              const isPdf = String(a.mimeType || '').toLowerCase().includes('pdf')
              return (
                <Pressable key={a.id} style={styles.tile} onPress={() => setGalleryIndex(i)}>
                  {isImage ? (
                    <Image source={{ uri: a.url }} style={styles.tileImage} />
                  ) : (
                    <View style={styles.tileIcon}>
                      <Ionicons name={isPdf ? 'document-outline' : 'document-text-outline'} size={26} color={colors.textSecondary} />
                      <Text style={styles.tileBadge}>{isPdf ? 'PDF' : 'FILE'}</Text>
                    </View>
                  )}
                  <Text style={styles.tileName} numberOfLines={1}>
                    {a.fileName}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        {data.canManage ? (
          <View style={styles.rowGap}>
            <Pressable style={styles.editButton} onPress={() => navigation.navigate('ScheduleCreate', { scheduleId })}>
              <Ionicons name="create-outline" size={20} color="#fff" />
              <Text style={styles.editButtonText}>Edit schedule</Text>
            </Pressable>
            <Pressable style={styles.deleteButton} onPress={confirmDelete}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      <AttachmentGalleryModal
        visible={galleryIndex !== null}
        attachments={gallery}
        index={galleryIndex ?? 0}
        onClose={() => setGalleryIndex(null)}
        onIndexChange={setGalleryIndex}
        entityType="job"
        entityId={job?.id}
      />

    </View>
  )
}

function MediaButton({ icon, label, onPress, disabled }: { icon: any; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.photoBtn, disabled && { opacity: 0.6 }]} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={18} color={colors.brandPrimary} />
      <Text style={styles.photoBtnText}>{label}</Text>
    </Pressable>
  )
}

function WorkButton({ icon, label, color, onPress, disabled }: { icon: any; label: string; color: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.workBtn, { backgroundColor: color }, disabled && { opacity: 0.6 }]} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={22} color="#fff" />
      <Text style={styles.workBtnText}>{label}</Text>
    </Pressable>
  )
}

function ActionButton({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.actionBtn} onPress={onPress}>
      <Ionicons name={icon} size={22} color={colors.brandPrimary} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.md },
  content: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.divider, gap: 4 },
  title: { ...typography.h2, color: colors.textPrimary },
  when: { ...typography.body, color: colors.textSecondary },
  jobLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, minHeight: 36 },
  jobLinkText: { ...typography.sub, color: colors.brandPrimary, fontWeight: '700', flexShrink: 1 },
  meta: { ...typography.caption, color: colors.textSecondary },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase' },
  big: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowGap: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  statusPillText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  timer: { fontSize: 40, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'], marginTop: spacing.xs },
  completion: { ...typography.body, color: colors.textPrimary, marginTop: spacing.xs },
  controls: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  workBtn: { flex: 1, minHeight: 56, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  workBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionText: { ...typography.caption, color: colors.brandPrimary, fontWeight: '700', textAlign: 'center' },
  managerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEF2F6', alignItems: 'center', justifyContent: 'center' },
  instructionsCard: { backgroundColor: '#fef3c7', borderColor: '#f59e0b', borderWidth: 2 },
  instructionsTitle: { fontSize: 18, fontWeight: '700', color: '#92400e' },
  instructions: { fontSize: 19, lineHeight: 27, fontWeight: '500', color: '#111827' },
  note: { ...typography.body, color: colors.textPrimary, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  tile: { width: '31%' },
  tileImage: { width: '100%', aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.background },
  tileIcon: { width: '100%', aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  tileBadge: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  tileName: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  editButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 10, backgroundColor: colors.brandPrimary },
  editButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deleteButton: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#fecaca' },
  headerMenuButton: { paddingHorizontal: 8, paddingVertical: 6 },
  finishPanel: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, gap: spacing.xs },
  input: { minHeight: 90, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.sm, padding: spacing.sm, ...typography.body, color: colors.textPrimary, textAlignVertical: 'top' },
  photoBtn: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.brandPrimary },
  photoBtnText: { color: colors.brandPrimary, fontWeight: '700' },
  thumbRow: { maxHeight: 84, marginTop: spacing.xs },
  finishThumbWrap: { marginRight: spacing.xs, paddingTop: 6, paddingRight: 6 },
  finishThumb: { width: 72, height: 72, borderRadius: radius.sm },
  videoThumb: { backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center' },
  videoThumbText: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 2 },
  removeThumb: { position: 'absolute', top: 0, right: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(15,23,42,0.8)', alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.divider },
  cancelText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  finishBtn: { flex: 2, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.info },
  finishText: { color: '#fff', fontSize: 17, fontWeight: '700' },
})
