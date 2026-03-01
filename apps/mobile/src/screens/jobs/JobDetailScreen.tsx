import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  Platform,
  Modal,
  Image,
  RefreshControl,
} from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import * as FileSystem from 'expo-file-system/legacy'
import { Video, ResizeMode } from 'expo-av'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { Attachment, Job, TimeEntry } from '../../types/models'
import { StatusChip } from '../../components/StatusChip'
import { API_BASE_URL, BRAND } from '../../config/env'
import { JobsStackParamList } from '../../types/navigation'
import { enqueueOutbox } from '../../offline/outbox'
import { useOnlineState } from '../../hooks/useOnlineState'
import { useAuth } from '../../auth/AuthContext'
import { useMobilePermissions } from '../../hooks/useMobilePermissions'

type Props = NativeStackScreenProps<JobsStackParamList, 'JobDetail'>

const JOB_STATUS_OPTIONS = [
  'QUOTE',
  'SCHEDULED',
  'IN_PROGRESS',
  'INSTALLATION_COMPLETE',
  'FINISHING_COMPLETE',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
  'INVOICED',
]

function formatStatusLabel(status: string) {
  return status
    .replace('INSTALLATION_COMPLETE', 'INSTALLATION COMPLETED')
    .replace('FINISHING_COMPLETE', 'FINISHING COMPLETED')
    .replaceAll('_', ' ')
}

interface JobResponse {
  job: Job
}

interface AttachmentsResponse {
  attachments: Attachment[]
}

interface AttachmentCreateResponse {
  attachment: Attachment
}

interface JobTimeResponse {
  entries: TimeEntry[]
  activeEntries: TimeEntry[]
  summary: {
    totalMinutes: number
    billableHours: number
    billableAmountCents: number
  }
  billing: {
    chargeByHour: boolean
    hourlyRateCents: number | null
  }
}

const MEDIA_BASE_URL = 'https://app.trimprony.com'

function normalizeMediaUrl(rawUrl: string) {
  const value = String(rawUrl || '').trim()
  if (!value) return value
  try {
    const parsed = new URL(value, MEDIA_BASE_URL)
    const host = parsed.hostname
    const isInternalHost = host === 'localhost' || host === '127.0.0.1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
    if (isInternalHost) {
      return `${MEDIA_BASE_URL}${parsed.pathname}${parsed.search}`
    }
    if (parsed.protocol === 'http:') parsed.protocol = 'https:'
    return parsed.toString()
  } catch {
    if (value.startsWith('/')) return `${MEDIA_BASE_URL}${value}`
    return value
  }
}

function formatCompactDate(value?: string | null) {
  if (!value) return 'No date'
  return new Date(value).toLocaleDateString()
}

export function JobDetailScreen({ route, navigation }: Props) {
  const { token, user } = useAuth()
  const isOnline = useOnlineState()
  const queryClient = useQueryClient()
  const jobId = route.params.jobId
  const [noteText, setNoteText] = useState('')
  const [locationSharing, setLocationSharing] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [localAttachments, setLocalAttachments] = useState<Attachment[]>([])
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false)
  const [videoViewerVisible, setVideoViewerVisible] = useState(false)
  const [statusPickerVisible, setStatusPickerVisible] = useState(false)
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [manualMinutes, setManualMinutes] = useState('')
  const [manualNote, setManualNote] = useState('')
  const [showManualEntry, setShowManualEntry] = useState(false)
  const {
    canCompleteJobs,
    canUploadMedia,
    canCreateTasks,
    canCreateIssues,
    canAssignTasksToAdmin,
    canAssignIssuesToAdmin,
    canScheduleJobs,
    canChangeJobStatus,
    canTrackTime,
    canEditOwnTimeEntries,
  } = useMobilePermissions()

  const jobQuery = useQuery({
    queryKey: ['mobile-job', jobId],
    queryFn: () => apiRequest<JobResponse>(`/api/mobile/jobs/${jobId}`),
    refetchInterval: 45_000,
  })

  const attachmentsQuery = useQuery({
    queryKey: ['mobile-job-attachments', jobId],
    queryFn: () => apiRequest<AttachmentsResponse>(`/api/attachments?entityType=job&entityId=${jobId}`),
    refetchInterval: 45_000,
  })

  const timeQuery = useQuery({
    queryKey: ['job-time', jobId],
    queryFn: () => apiRequest<JobTimeResponse>(`/api/jobs/${jobId}/time`),
    enabled: !!jobQuery.data?.job?.chargeByHour && canTrackTime(),
    refetchInterval: 30_000,
  })

  const job = jobQuery.data?.job
  const onRefresh = async () => {
    await Promise.all([jobQuery.refetch(), attachmentsQuery.refetch(), timeQuery.refetch()])
  }

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      if (!isOnline) {
        await enqueueOutbox({
          id: `${Date.now()}-status-${jobId}`,
          type: 'job-status',
          payload: { jobId, status, notes: `mobileStatus:${status}` },
        })
        return
      }
      await apiRequest(`/api/mobile/jobs/${jobId}/status`, 'POST', {
        status,
        notes: `mobileStatus:${status}`,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mobile-job', jobId] })
      queryClient.invalidateQueries({ queryKey: ['mobile-jobs'] })
    },
  })

  const noteMutation = useMutation({
    mutationFn: async () => {
      const content = noteText.trim()
      if (!content) return
      if (!isOnline) {
        await enqueueOutbox({
          id: `${Date.now()}-note-${jobId}`,
          type: 'job-note',
          payload: { jobId, content },
        })
        return
      }
      await apiRequest(`/api/mobile/jobs/${jobId}/note`, 'POST', { content })
    },
    onSuccess: () => setNoteText(''),
  })

  const myActiveEntry = useMemo(
    () => (timeQuery.data?.activeEntries || []).find((entry) => entry.workerId === user?.id) || null,
    [timeQuery.data?.activeEntries, user?.id]
  )

  useEffect(() => {
    if (!myActiveEntry) {
      setElapsedSeconds(0)
      return
    }
    const start = new Date(myActiveEntry.startedAt || myActiveEntry.createdAt).getTime()
    const tick = () => {
      const next = Math.max(0, Math.floor((Date.now() - start) / 1000))
      setElapsedSeconds(next)
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [myActiveEntry])

  const startTimeMutation = useMutation({
    mutationFn: async () => {
      if (!job) return
      if (!isOnline) {
        await enqueueOutbox({
          id: `${Date.now()}-time-start-${job.id}`,
          type: 'time-start',
          payload: { jobId: job.id, startedAt: new Date().toISOString() },
        })
        return
      }
      await apiRequest(`/api/jobs/${job.id}/time/start`, 'POST', {
        startedAt: new Date().toISOString(),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-time', jobId] })
      queryClient.invalidateQueries({ queryKey: ['mobile-job', jobId] })
    },
    onError: (error: any) => {
      Alert.alert('Unable to start timer', error?.message || 'Try again.')
    },
  })

  const stopTimeMutation = useMutation({
    mutationFn: async (note?: string) => {
      if (!job) return
      if (!isOnline) {
        await enqueueOutbox({
          id: `${Date.now()}-time-stop-${job.id}`,
          type: 'time-stop',
          payload: { jobId: job.id, endedAt: new Date().toISOString(), note: note || undefined },
        })
        return
      }
      await apiRequest(`/api/jobs/${job.id}/time/stop`, 'POST', {
        endedAt: new Date().toISOString(),
        note: note || undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-time', jobId] })
      queryClient.invalidateQueries({ queryKey: ['mobile-job', jobId] })
    },
    onError: (error: any) => {
      Alert.alert('Unable to stop timer', error?.message || 'Try again.')
    },
  })

  const manualTimeMutation = useMutation({
    mutationFn: async () => {
      if (!job) return
      const trimmed = manualMinutes.trim()
      const parts = trimmed.split(':')
      const minutes =
        parts.length === 2
          ? Math.max(0, Number(parts[0]) * 60 + Number(parts[1]))
          : Math.max(0, Number(trimmed))
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error('Enter minutes as mm or hh:mm')
      }
      if (!manualNote.trim()) {
        throw new Error('A note is required for manual time entries')
      }

      if (!isOnline) {
        await enqueueOutbox({
          id: `${Date.now()}-time-manual-${job.id}`,
          type: 'time-manual',
          payload: {
            jobId: job.id,
            durationMinutes: minutes,
            note: manualNote.trim(),
          },
        })
        return
      }

      await apiRequest(`/api/jobs/${job.id}/time/manual`, 'POST', {
        durationMinutes: minutes,
        note: manualNote.trim(),
      })
    },
    onSuccess: () => {
      setManualMinutes('')
      setManualNote('')
      setShowManualEntry(false)
      queryClient.invalidateQueries({ queryKey: ['job-time', jobId] })
      queryClient.invalidateQueries({ queryKey: ['mobile-job', jobId] })
    },
    onError: (error: any) => {
      Alert.alert('Manual time failed', error?.message || 'Try again.')
    },
  })

  const onPickMedia = async (fromCamera: boolean) => {
    if (!token) return
    try {
      const permissionResult = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permissionResult.granted) {
        Alert.alert('Permission required', 'Please grant media permission to upload files.')
        return
      }

      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['images', 'videos'],
            quality: 0.72,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images', 'videos'],
            quality: 0.72,
          })

      if (result.canceled || result.assets.length === 0) return

      const asset = result.assets[0]
      const guessedMime = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg')
      const fileName = asset.fileName || `job-${jobId}-${Date.now()}`
      const fileSize = asset.fileSize || 0

      if (!isOnline) {
        await enqueueOutbox({
          id: `${Date.now()}-media-${jobId}`,
          type: 'job-media',
          payload: {
            jobId,
            uri: asset.uri,
            fileName,
            fileSize,
            mimeType: guessedMime,
          },
        })
        Alert.alert('Queued', 'Media was added to outbox and will sync when online.')
        return
      }

      if (guessedMime.startsWith('video/') && fileSize > 120 * 1024 * 1024) {
        Alert.alert('Large file warning', 'This video is very large and may upload slowly in the field.')
      }

      setUploadProgress(0)
      const uploadResult = await FileSystem.uploadAsync(`${API_BASE_URL}/api/uploads`, asset.uri, {
        fieldName: 'file',
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        mimeType: guessedMime,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      })
      setUploadProgress(1)

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        let detail = ''
        try {
          const parsed = JSON.parse(uploadResult.body || '{}')
          detail = parsed?.error ? String(parsed.error) : ''
        } catch {
          detail = uploadResult.body || ''
        }
        throw new Error(detail || `Upload failed (${uploadResult.status})`)
      }
      const uploadPayload = JSON.parse(uploadResult.body || '{}')
      const persistedFileSize = Number(uploadPayload?.size || fileSize || 0)
      if (!persistedFileSize || persistedFileSize <= 0) {
        throw new Error('Upload completed but file size could not be determined.')
      }

      let geoMeta: any = null
      try {
        const perm = await Location.getForegroundPermissionsAsync()
        if (perm.granted) {
          const pos = await Location.getLastKnownPositionAsync()
          if (pos?.coords) {
            geoMeta = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            }
          }
        }
      } catch {
        // Optional metadata only.
      }

      const created = await apiRequest<AttachmentCreateResponse>('/api/attachments', 'POST', {
        entityType: 'job',
        entityId: jobId,
        fileName,
        url: normalizeMediaUrl(uploadPayload.url),
        key: uploadPayload.filename || uploadPayload.url,
        mimeType: guessedMime,
        fileSize: persistedFileSize,
        metadata: {
          uploadedAtClient: new Date().toISOString(),
          device: {
            os: Platform.OS,
            osVersion: String((Platform as any).Version ?? ''),
          },
          geo: geoMeta,
        },
      })

      setUploadProgress(null)
      if (created?.attachment) {
        setLocalAttachments((prev) => [
          { ...created.attachment, url: normalizeMediaUrl(created.attachment.url) },
          ...prev.filter((x) => x.id !== created.attachment.id),
        ])
      }
      queryClient.invalidateQueries({ queryKey: ['mobile-job-attachments', jobId] })
      queryClient.invalidateQueries({ queryKey: ['mobile-job', jobId] })
      Alert.alert('Uploaded', 'Attachment uploaded successfully.')
    } catch (error: any) {
      setUploadProgress(null)
      Alert.alert('Upload failed', error?.message || 'Please retry.')
    }
  }

  const onToggleLocation = async (enabled: boolean) => {
    setLocationSharing(enabled)
    if (!enabled || !job) return
    const permission = await Location.requestForegroundPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Permission required', 'Location permission is required to share location with dispatch.')
      setLocationSharing(false)
      return
    }

    const position = await Location.getCurrentPositionAsync({})
    await apiRequest('/api/mobile/location', 'POST', {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: new Date().toISOString(),
      jobId: job.id,
    }).catch(() => {
      // Non-blocking by design in poor field connectivity.
    })
  }

  const attachmentRows = useMemo(() => {
    const fromJob = job?.attachments || []
    const fromAttachmentApi = attachmentsQuery.data?.attachments || []
    const merged = [...localAttachments, ...fromAttachmentApi, ...fromJob]
    const deduped = new Map<string, Attachment>()
    for (const row of merged) {
      if (!row?.id) continue
      if (!deduped.has(row.id)) {
        deduped.set(row.id, {
          ...row,
          url: normalizeMediaUrl(row.url),
        })
      }
    }
    return Array.from(deduped.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [attachmentsQuery.data?.attachments, job?.attachments, localAttachments])

  const imageRows = useMemo(
    () => attachmentRows.filter((row) => String(row.mimeType || '').startsWith('image/')),
    [attachmentRows]
  )
  const videoRows = useMemo(
    () => attachmentRows.filter((row) => String(row.mimeType || '').startsWith('video/')),
    [attachmentRows]
  )
  const otherRows = useMemo(
    () => attachmentRows.filter((row) => !String(row.mimeType || '').startsWith('image/') && !String(row.mimeType || '').startsWith('video/')),
    [attachmentRows]
  )
  const formatElapsed = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={jobQuery.isRefetching || attachmentsQuery.isRefetching} onRefresh={onRefresh} />}
      >
        {jobQuery.isError ? (
          <View style={styles.errorWrap}>
            <Text style={styles.empty}>Unable to load job details.</Text>
            <Pressable style={styles.secondaryButton} onPress={() => jobQuery.refetch()}>
              <Text style={styles.secondaryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : !job ? (
          <Text style={styles.empty}>Loading job details...</Text>
        ) : (
          <>
            <Text style={styles.title}>
              {job.jobNumber} - {job.title}
            </Text>
            <StatusChip status={job.status} />
            <Text style={styles.meta}>Client: {job.client?.name || 'N/A'}</Text>
            <Text style={styles.meta}>Phone: {job.client?.phone || 'N/A'}</Text>
            {!isOnline ? <Text style={styles.offlineBadge}>Offline - showing last synced data</Text> : null}
            {job.address?.street ? (
              <Pressable
                onPress={() => {
                  const addressObj = job.address
                  if (!addressObj) return
                  const address = `${addressObj.street}, ${addressObj.city || ''} ${addressObj.state || ''} ${addressObj.zipCode || ''}`.trim()
                  const encodedAddress = encodeURIComponent(address)
                  
                  // Try Google Maps app first
                  const androidGoogleMapsUrl = `comgooglemaps://?q=${encodedAddress}`
                  const iosGoogleMapsUrl = `googlemaps://?q=${encodedAddress}`
                  // Fallback to native maps
                  const appleMapsUrl = `maps://?q=${encodedAddress}`
                  // Final fallback to web Google Maps
                  const webMapsUrl = `https://maps.google.com/?q=${encodedAddress}`
                  
                  const googleMapsUrl = Platform.OS === 'android' ? androidGoogleMapsUrl : iosGoogleMapsUrl
                  
                  // Try Google Maps app first
                  Linking.canOpenURL(googleMapsUrl)
                    .then((supported) => {
                      if (supported) {
                        return Linking.openURL(googleMapsUrl)
                      }
                      // Fallback to native maps (iOS Maps or Android Maps)
                      return Linking.canOpenURL(appleMapsUrl).then((nativeSupported) => {
                        if (nativeSupported) {
                          return Linking.openURL(appleMapsUrl)
                        }
                        // Final fallback to web
                        return Linking.openURL(webMapsUrl)
                      })
                    })
                    .catch(() => Linking.openURL(webMapsUrl))
                }}
              >
                <Text style={[styles.meta, styles.addressLink]}>
                  Address: {`${job.address.street}, ${job.address.city || ''} ${job.address.state || ''}`}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.meta}>Address: No job site</Text>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Status</Text>
              <Pressable
                style={styles.statusSelectTrigger}
                onPress={() => {
                  if (!canChangeJobStatus()) {
                    Alert.alert('Permission denied', 'You do not have permission to change job status.')
                    return
                  }
                  setStatusPickerVisible(true)
                }}
              >
                <Text style={styles.statusSelectValue}>{formatStatusLabel(job.status)}</Text>
                <Ionicons name="chevron-down" size={18} color={BRAND.text} />
              </Pressable>
              <Text style={styles.meta}>Select a status to update this job.</Text>
            </View>

            {job.chargeByHour && canTrackTime() && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Time Tracker</Text>
                <Text style={styles.meta}>
                  Hourly rate: {job.hourlyRateCents ? `$${(job.hourlyRateCents / 100).toFixed(2)}/hr` : 'Not set'}
                </Text>
                <Text style={styles.meta}>
                  Total tracked: {Math.floor((timeQuery.data?.summary.totalMinutes || job.billableMinutesTotal || 0) / 60)}h {(timeQuery.data?.summary.totalMinutes || job.billableMinutesTotal || 0) % 60}m
                </Text>
                {!!myActiveEntry && (
                  <Text style={styles.meta}>Active timer: {formatElapsed(elapsedSeconds)}</Text>
                )}

                <View style={styles.row}>
                  {!myActiveEntry ? (
                    <Pressable style={styles.primaryButton} onPress={() => startTimeMutation.mutate()}>
                      <Text style={styles.primaryButtonText}>
                        {(timeQuery.data?.summary.totalMinutes || 0) > 0 ? 'Resume Timer' : 'Start Timer'}
                      </Text>
                    </Pressable>
                  ) : (
                    <>
                      <Pressable style={styles.secondaryButton} onPress={() => stopTimeMutation.mutate('Paused from mobile')}>
                        <Text style={styles.secondaryButtonText}>Pause</Text>
                      </Pressable>
                      <Pressable style={styles.primaryButton} onPress={() => stopTimeMutation.mutate('Stopped from mobile')}>
                        <Text style={styles.primaryButtonText}>Stop</Text>
                      </Pressable>
                    </>
                  )}
                  {!myActiveEntry && (
                    <Pressable style={styles.secondaryButton} onPress={() => setShowManualEntry((v) => !v)}>
                      <Text style={styles.secondaryButtonText}>Manual Time</Text>
                    </Pressable>
                  )}
                </View>

                {showManualEntry && canEditOwnTimeEntries() && (
                  <View style={styles.section}>
                    <Text style={styles.meta}>Duration (minutes or hh:mm)</Text>
                    <TextInput
                      value={manualMinutes}
                      onChangeText={setManualMinutes}
                      placeholder="60 or 01:00"
                      placeholderTextColor={BRAND.text}
                      style={styles.noteInput}
                    />
                    <Text style={styles.meta}>Note (required)</Text>
                    <TextInput
                      value={manualNote}
                      onChangeText={setManualNote}
                      placeholder="Reason for manual entry"
                      placeholderTextColor={BRAND.text}
                      style={styles.noteInput}
                    />
                    <Pressable style={styles.primaryButton} onPress={() => manualTimeMutation.mutate()}>
                      <Text style={styles.primaryButtonText}>Save Manual Entry</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notes</Text>
              <TextInput
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Add internal note..."
                placeholderTextColor={BRAND.text}
                multiline
                style={styles.noteInput}
              />
              <Pressable style={styles.primaryButton} onPress={() => noteMutation.mutate()}>
                <Text style={styles.primaryButtonText}>Save Note</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Tasks</Text>
                <Text style={styles.countBadge}>{job.tasks?.length || 0}</Text>
              </View>
              {(job.tasks || []).length === 0 ? (
                <Text style={styles.meta}>No tasks for this job.</Text>
              ) : (
                (job.tasks || []).map((task) => (
                  <Pressable
                    key={task.id}
                    style={styles.linkedRow}
                    onPress={() => {
                      void Linking.openURL(`trimpro://tasks/${task.id}`)
                    }}
                  >
                    <View style={styles.linkedRowTop}>
                      <Text style={styles.linkedTitle} numberOfLines={1}>
                        {task.title}
                      </Text>
                      <View style={styles.inlinePills}>
                        <Text style={styles.statusPill}>{task.status.replaceAll('_', ' ')}</Text>
                        <Text style={styles.priorityPill}>{task.priority}</Text>
                      </View>
                    </View>
                    <Text style={styles.meta} numberOfLines={1}>
                      {task.assignedTo?.name || 'Unassigned'} • Due {formatCompactDate(task.dueDate)}
                    </Text>
                    {task.shortDescription ? (
                      <Text style={styles.meta} numberOfLines={2}>
                        {task.shortDescription}
                      </Text>
                    ) : null}
                  </Pressable>
                ))
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Issues</Text>
                <Text style={styles.countBadge}>{job.issues?.length || 0}</Text>
              </View>
              {(job.issues || []).length === 0 ? (
                <Text style={styles.meta}>No issues for this job.</Text>
              ) : (
                (job.issues || []).map((issue) => (
                  <Pressable
                    key={issue.id}
                    style={styles.linkedRow}
                    onPress={() => {
                      void Linking.openURL(`trimpro://issues/${issue.id}`)
                    }}
                  >
                    <View style={styles.linkedRowTop}>
                      <Text style={styles.linkedTitle} numberOfLines={1}>
                        {issue.title}
                      </Text>
                      <View style={styles.inlinePills}>
                        <Text style={styles.statusPill}>{issue.status.replaceAll('_', ' ')}</Text>
                        <Text style={styles.priorityPill}>{issue.priority}</Text>
                      </View>
                    </View>
                    <Text style={styles.meta} numberOfLines={1}>
                      {issue.assignedTo?.name || 'Unassigned'} • Updated {formatCompactDate(issue.updatedAt)}
                    </Text>
                    {issue.shortDescription ? (
                      <Text style={styles.meta} numberOfLines={2}>
                        {issue.shortDescription}
                      </Text>
                    ) : null}
                  </Pressable>
                ))
              )}
            </View>

            {canUploadMedia() && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Files and Media</Text>
                  <Text style={styles.countBadge}>{attachmentRows.length}</Text>
                </View>
                <View style={styles.row}>
                  <Pressable style={styles.secondaryButton} onPress={() => onPickMedia(false)}>
                    <Text style={styles.secondaryButtonText}>Upload from gallery</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={() => onPickMedia(true)}>
                    <Text style={styles.secondaryButtonText}>Take photo / video</Text>
                  </Pressable>
                </View>
              {uploadProgress !== null && (
                <Text style={styles.meta}>Upload progress: {Math.round(uploadProgress * 100)}%</Text>
              )}
              {imageRows.length > 0 && (
                <View>
                  <Text style={styles.meta}>Images</Text>
                  <View style={styles.mediaGrid}>
                    {imageRows.map((a) => (
                      <Pressable
                        key={a.id}
                        onPress={() => {
                          const idx = imageRows.findIndex((x) => x.id === a.id)
                          setActiveImageIndex(Math.max(0, idx))
                          setMediaViewerVisible(true)
                        }}
                      >
                        <Image source={{ uri: a.url }} style={styles.imageThumb} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {videoRows.length > 0 && (
                <View>
                  <Text style={styles.meta}>Videos</Text>
                  {videoRows.map((a) => (
                    <Pressable
                      key={a.id}
                      style={styles.attachmentRow}
                      onPress={() => {
                        setActiveVideoUrl(a.url)
                        setVideoViewerVisible(true)
                      }}
                    >
                      <Text style={styles.attachmentName} numberOfLines={1}>
                        Play video: {a.fileName}
                      </Text>
                      <Text style={styles.attachmentMeta}>{Math.round(a.fileSize / 1024)} KB</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {otherRows.length > 0 && (
                <View>
                  <Text style={styles.meta}>Files</Text>
                  {otherRows.map((a) => (
                    <Pressable
                      key={a.id}
                      style={styles.attachmentRow}
                      onPress={() => {
                        void Linking.openURL(a.url)
                      }}
                    >
                      <Text style={styles.attachmentName} numberOfLines={1}>
                        {a.fileName}
                      </Text>
                      <Text style={styles.attachmentMeta}>{Math.round(a.fileSize / 1024)} KB</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {attachmentRows.length === 0 && <Text style={styles.meta}>No media for this job yet.</Text>}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Location</Text>
              <View style={styles.row}>
                <Text style={styles.meta}>Share location with dispatch while active</Text>
                <Switch value={locationSharing} onValueChange={onToggleLocation} />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Quick Actions</Text>
              <View style={styles.row}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={async () => {
                      if (!job) return
                      try {
                        const team = await apiRequest<{ conversationId: string }>('/api/messages/team/ensure', 'POST', {})
                        const parentNav: any = navigation.getParent()?.getParent() || navigation.getParent()
                        parentNav?.navigate('MainTabs', {
                          screen: 'MessagesTab',
                          params: {
                            screen: 'MessageThread',
                            params: {
                              conversationId: team.conversationId,
                              jobContext: {
                                jobId: job.id,
                                jobNumber: job.jobNumber,
                                jobName: job.title,
                              },
                            },
                          },
                        })
                      } catch (error: any) {
                        Alert.alert('Error', error?.message || 'Failed to open Team Chat')
                      }
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>Send Message (Team)</Text>
                  </Pressable>
                  {!!job.assignedTo?.id && job.assignedTo.id !== user?.id && (
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={async () => {
                        if (!job?.assignedTo?.id || !job) return
                        try {
                          const dm = await apiRequest<{ conversationId: string }>('/api/messages/dm', 'POST', {
                            userId: job.assignedTo.id,
                          })
                          const parentNav: any = navigation.getParent()?.getParent() || navigation.getParent()
                          parentNav?.navigate('MainTabs', {
                            screen: 'MessagesTab',
                            params: {
                              screen: 'MessageThread',
                              params: {
                                conversationId: dm.conversationId,
                                jobContext: {
                                  jobId: job.id,
                                  jobNumber: job.jobNumber,
                                  jobName: job.title,
                                },
                              },
                            },
                          })
                        } catch (error: any) {
                          Alert.alert('Error', error?.message || 'Failed to open direct message')
                        }
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>Send DM to Assignee</Text>
                    </Pressable>
                  )}
                  {canCreateTasks() && (
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={async () => {
                        if (!job) return
                        try {
                          // Get admin users for assignment
                          const usersResponse = await apiRequest<{ users: Array<{ id: string; role: string; firstName: string; lastName: string }> }>(
                            '/api/users?role=ADMIN&limit=10'
                          )
                          const adminUsers = usersResponse.users.filter((u) => u.role === 'ADMIN' || u.role === 'OFFICE')
                          
                          if (adminUsers.length === 0) {
                            Alert.alert('No Admin Users', 'No admin users found to assign the task to.')
                            return
                          }

                          // If user can only assign to admin, use first admin
                          // If user can assign to any, they could choose, but for simplicity, auto-assign to first admin
                          const assigneeId = adminUsers[0].id
                          
                          await apiRequest('/api/tasks?mobile=true', 'POST', {
                            title: `Task for ${job.jobNumber}`,
                            description: `Task created from job ${job.jobNumber}: ${job.title}`,
                            assigneeId,
                            jobId: job.id,
                            priority: 'MEDIUM',
                            status: 'TODO',
                          })

                          Alert.alert('Success', `Task created and assigned to ${adminUsers[0].firstName} ${adminUsers[0].lastName}`)
                          queryClient.invalidateQueries({ queryKey: ['mobile-assignments'] })
                        } catch (error: any) {
                          Alert.alert('Error', error?.message || 'Failed to create task')
                        }
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>Create Task for Admin</Text>
                    </Pressable>
                  )}
                  {canCreateIssues() && (
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={async () => {
                        if (!job) return
                        try {
                          // Get admin users for assignment
                          const usersResponse = await apiRequest<{ users: Array<{ id: string; role: string; firstName: string; lastName: string }> }>(
                            '/api/users?role=ADMIN&limit=10'
                          )
                          const adminUsers = usersResponse.users.filter((u) => u.role === 'ADMIN' || u.role === 'OFFICE')
                          
                          if (adminUsers.length === 0) {
                            Alert.alert('No Admin Users', 'No admin users found to assign the issue to.')
                            return
                          }

                          const assigneeId = adminUsers[0].id
                          
                          await apiRequest('/api/issues?mobile=true', 'POST', {
                            title: `Issue for ${job.jobNumber}`,
                            description: `Issue created from job ${job.jobNumber}: ${job.title}`,
                            assigneeId,
                            jobId: job.id,
                            type: 'OTHER',
                            priority: 'MEDIUM',
                            status: 'OPEN',
                          })

                          Alert.alert('Success', `Issue created and assigned to ${adminUsers[0].firstName} ${adminUsers[0].lastName}`)
                          queryClient.invalidateQueries({ queryKey: ['mobile-assignments'] })
                        } catch (error: any) {
                          Alert.alert('Error', error?.message || 'Failed to create issue')
                        }
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>Create Issue for Admin</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => {
                      if (!job) return
                      if (!canScheduleJobs()) {
                        Alert.alert('Permission denied', 'You do not have permission to schedule jobs.')
                        return
                      }
                      const rootNav: any = navigation.getParent()?.getParent() || navigation.getParent()
                      rootNav?.navigate('MainTabs', {
                        screen: 'ScheduleTab',
                        params: {
                          screen: 'ScheduleCreate',
                          params: {
                            jobId: job.id,
                            assignedUserId: job.assignedTo?.id,
                            title: `${job.jobNumber} - ${job.title}`,
                          },
                        },
                      })
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>Create Schedule</Text>
                  </Pressable>
              </View>
            </View>

            <Modal visible={statusPickerVisible} transparent animationType="fade" onRequestClose={() => setStatusPickerVisible(false)}>
              <View style={styles.modalBackdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setStatusPickerVisible(false)} />
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>Update Job Status</Text>
                  <ScrollView style={{ maxHeight: 360 }}>
                    {JOB_STATUS_OPTIONS.map((status) => {
                      const active = job.status === status
                      return (
                        <Pressable
                          key={status}
                          style={[styles.modalRow, active && styles.modalRowActive]}
                          onPress={() => {
                            setStatusPickerVisible(false)
                            if (active) return
                            if (status === 'COMPLETED' && !canCompleteJobs()) {
                              Alert.alert('Permission denied', 'You do not have permission to complete jobs.')
                              return
                            }
                            if (status === 'COMPLETED' && myActiveEntry) {
                              Alert.alert('Active timer', 'Stop timer and complete this job?', [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Stop and Complete',
                                  onPress: async () => {
                                    try {
                                      await stopTimeMutation.mutateAsync('Stopped automatically on completion')
                                    } finally {
                                      statusMutation.mutate(status)
                                    }
                                  },
                                },
                              ])
                              return
                            }
                            statusMutation.mutate(status)
                          }}
                        >
                          <Text style={styles.modalRowTitle}>{formatStatusLabel(status)}</Text>
                          {active ? <Ionicons name="checkmark" size={18} color={BRAND.primary} /> : null}
                        </Pressable>
                      )
                    })}
                  </ScrollView>
                </View>
              </View>
            </Modal>

            <Modal visible={mediaViewerVisible} animationType="slide" onRequestClose={() => setMediaViewerVisible(false)}>
              <View style={styles.viewerRoot}>
                <View style={styles.viewerHeader}>
                  <Pressable style={styles.secondaryButton} onPress={() => setMediaViewerVisible(false)}>
                    <Text style={styles.secondaryButtonText}>Close</Text>
                  </Pressable>
                  <Text style={styles.viewerTitle}>
                    {imageRows.length > 0 ? `${activeImageIndex + 1} / ${imageRows.length}` : 'Image'}
                  </Text>
                  <View style={{ width: 88 }} />
                </View>
                {imageRows[activeImageIndex] ? (
                  <ScrollView
                    contentContainerStyle={styles.viewerImageWrap}
                    minimumZoomScale={1}
                    maximumZoomScale={4}
                    centerContent
                  >
                    <Image source={{ uri: imageRows[activeImageIndex].url }} style={styles.viewerImage} resizeMode="contain" />
                  </ScrollView>
                ) : null}
                <View style={styles.viewerControls}>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => setActiveImageIndex((idx) => Math.max(0, idx - 1))}
                    disabled={activeImageIndex <= 0}
                  >
                    <Text style={styles.secondaryButtonText}>Prev</Text>
                  </Pressable>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => setActiveImageIndex((idx) => Math.min(imageRows.length - 1, idx + 1))}
                    disabled={activeImageIndex >= imageRows.length - 1}
                  >
                    <Text style={styles.secondaryButtonText}>Next</Text>
                  </Pressable>
                </View>
              </View>
            </Modal>

            <Modal visible={videoViewerVisible} animationType="slide" onRequestClose={() => setVideoViewerVisible(false)}>
              <View style={styles.viewerRoot}>
                <View style={styles.viewerHeader}>
                  <Pressable style={styles.secondaryButton} onPress={() => setVideoViewerVisible(false)}>
                    <Text style={styles.secondaryButtonText}>Close</Text>
                  </Pressable>
                  <Text style={styles.viewerTitle}>Video</Text>
                  <View style={{ width: 88 }} />
                </View>
                {activeVideoUrl ? (
                  <Video
                    source={{ uri: activeVideoUrl }}
                    style={styles.videoPlayer}
                    useNativeControls
                    shouldPlay
                    resizeMode={ResizeMode.CONTAIN}
                  />
                ) : (
                  <Text style={styles.meta}>No video selected.</Text>
                )}
              </View>
            </Modal>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: {
    padding: 14,
    gap: 10,
    paddingBottom: 40,
  },
  empty: {
    color: BRAND.muted,
    textAlign: 'center',
    marginTop: 40,
  },
  errorWrap: {
    marginTop: 40,
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: BRAND.text,
  },
  meta: {
    fontSize: 13,
    color: BRAND.muted,
  },
  offlineBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    color: '#92400E',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '700',
  },
  section: {
    backgroundColor: BRAND.white,
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: BRAND.text,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countBadge: {
    minWidth: 22,
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 12,
  },
  linkedRow: {
    borderTopWidth: 1,
    borderColor: '#EAECF0',
    paddingTop: 8,
    gap: 4,
  },
  linkedRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  linkedTitle: {
    color: BRAND.text,
    fontWeight: '700',
    flex: 1,
  },
  inlinePills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPill: {
    backgroundColor: '#E0F2FE',
    color: '#0C4A6E',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '700',
  },
  priorityPill: {
    backgroundColor: '#F1F5F9',
    color: '#334155',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '700',
  },
  statusWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusSelectTrigger: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: BRAND.white,
  },
  statusSelectValue: {
    color: BRAND.text,
    fontWeight: '600',
    fontSize: 13,
  },
  statusButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  statusButtonActive: {
    borderColor: BRAND.primary,
    backgroundColor: '#EEF4F7',
  },
  statusButtonDisabled: {
    opacity: 0.5,
  },
  statusButtonText: {
    color: '#475467',
    fontWeight: '600',
    fontSize: 12,
  },
  statusButtonTextActive: {
    color: BRAND.primary,
  },
  noteInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 12,
    padding: 10,
    textAlignVertical: 'top',
    color: BRAND.text,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  primaryButton: {
    backgroundColor: BRAND.primary,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: BRAND.white,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: BRAND.text,
    fontWeight: '600',
  },
  attachmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#EAECF0',
    paddingTop: 8,
  },
  attachmentName: {
    color: BRAND.text,
    flex: 1,
    marginRight: 8,
  },
  attachmentMeta: {
    color: BRAND.muted,
    fontSize: 12,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  imageThumb: {
    width: 96,
    height: 96,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerHeader: {
    paddingTop: 50,
    paddingHorizontal: 12,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0B1020',
  },
  viewerTitle: {
    color: '#fff',
    fontWeight: '700',
  },
  viewerImageWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerControls: {
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#0B1020',
  },
  videoPlayer: {
    flex: 1,
    width: '100%',
  },
  addressLink: {
    color: BRAND.primary,
    textDecorationLine: 'underline',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    borderRadius: 14,
    backgroundColor: BRAND.white,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    padding: 10,
  },
  modalTitle: {
    color: BRAND.text,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 8,
  },
  modalRow: {
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalRowActive: {
    backgroundColor: 'rgba(15,76,92,0.1)',
  },
  modalRowTitle: {
    color: BRAND.text,
    fontWeight: '600',
  },
})

