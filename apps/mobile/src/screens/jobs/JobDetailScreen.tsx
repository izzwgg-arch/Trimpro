import React, { useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import * as FileSystem from 'expo-file-system/legacy'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { Attachment, Job } from '../../types/models'
import { StatusChip } from '../../components/StatusChip'
import { BRAND } from '../../config/env'
import { JobsStackParamList } from '../../types/navigation'
import { enqueueOutbox } from '../../offline/outbox'
import { useOnlineState } from '../../hooks/useOnlineState'
import { useAuth } from '../../auth/AuthContext'

type Props = NativeStackScreenProps<JobsStackParamList, 'JobDetail'>

const FIELD_STATUS_FLOW = ['ASSIGNED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'COMPLETED']
const FIELD_TO_BACKEND_STATUS: Record<string, string> = {
  ASSIGNED: 'SCHEDULED',
  EN_ROUTE: 'SCHEDULED',
  ON_SITE: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
}

interface JobResponse {
  job: Job
}

interface AttachmentsResponse {
  attachments: Attachment[]
}

export function JobDetailScreen({ route }: Props) {
  const { token } = useAuth()
  const isOnline = useOnlineState()
  const queryClient = useQueryClient()
  const jobId = route.params.jobId
  const [noteText, setNoteText] = useState('')
  const [locationSharing, setLocationSharing] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

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

  const job = jobQuery.data?.job

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const backendStatus = FIELD_TO_BACKEND_STATUS[status] || status
      if (!isOnline) {
        await enqueueOutbox({
          id: `${Date.now()}-status-${jobId}`,
          type: 'job-status',
          payload: { jobId, status: backendStatus, notes: `fieldStage:${status}` },
        })
        return
      }
      await apiRequest(`/api/mobile/jobs/${jobId}/status`, 'POST', {
        status: backendStatus,
        notes: `fieldStage:${status}`,
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

      const uploadTask = FileSystem.createUploadTask(
        `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '') || 'http://localhost:3000'}/api/uploads`,
        asset.uri,
        {
          fieldName: 'file',
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          mimeType: guessedMime,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        },
        (progressEvent) => {
          if (!progressEvent.totalBytesExpectedToSend) return
          setUploadProgress(progressEvent.totalBytesSent / progressEvent.totalBytesExpectedToSend)
        }
      )

      const uploadResult = await uploadTask.uploadAsync()
      if (!uploadResult || uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error('Upload failed')
      }
      const uploadPayload = JSON.parse(uploadResult.body)

      await apiRequest('/api/attachments', 'POST', {
        entityType: 'job',
        entityId: jobId,
        fileName,
        url: uploadPayload.url,
        key: uploadPayload.filename || uploadPayload.url,
        mimeType: guessedMime,
        fileSize,
      })

      setUploadProgress(null)
      queryClient.invalidateQueries({ queryKey: ['mobile-job-attachments', jobId] })
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

  const attachmentRows = useMemo(() => attachmentsQuery.data?.attachments ?? [], [attachmentsQuery.data?.attachments])

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {!job ? (
          <Text style={styles.empty}>Loading job details...</Text>
        ) : (
          <>
            <Text style={styles.title}>
              {job.jobNumber} - {job.title}
            </Text>
            <StatusChip status={job.status} />
            <Text style={styles.meta}>Client: {job.client?.name || 'N/A'}</Text>
            <Text style={styles.meta}>Phone: {job.client?.phone || 'N/A'}</Text>
            <Text style={styles.meta}>
              Address:{' '}
              {job.address?.street
                ? `${job.address.street}, ${job.address.city || ''} ${job.address.state || ''}`
                : 'No job site'}
            </Text>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Status flow</Text>
              <View style={styles.statusWrap}>
                {FIELD_STATUS_FLOW.map((status) => (
                  <Pressable
                    key={status}
                    style={[styles.statusButton, job.status === status && styles.statusButtonActive]}
                    onPress={() => statusMutation.mutate(status)}
                  >
                    <Text style={[styles.statusButtonText, job.status === status && styles.statusButtonTextActive]}>
                      {status.replaceAll('_', ' ')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notes</Text>
              <TextInput
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Add internal note..."
                multiline
                style={styles.noteInput}
              />
              <Pressable style={styles.primaryButton} onPress={() => noteMutation.mutate()}>
                <Text style={styles.primaryButtonText}>Save Note</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Media uploads</Text>
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
              {attachmentRows.map((a) => (
                <View key={a.id} style={styles.attachmentRow}>
                  <Text style={styles.attachmentName} numberOfLines={1}>
                    {a.fileName}
                  </Text>
                  <Text style={styles.attachmentMeta}>{Math.round(a.fileSize / 1024)} KB</Text>
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Location</Text>
              <View style={styles.row}>
                <Text style={styles.meta}>Share location with dispatch while active</Text>
                <Switch value={locationSharing} onValueChange={onToggleLocation} />
              </View>
            </View>
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
  },
  empty: {
    color: BRAND.muted,
    textAlign: 'center',
    marginTop: 40,
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
  statusWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
})

