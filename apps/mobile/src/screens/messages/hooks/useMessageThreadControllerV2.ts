import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, FlatList, GestureResponderEvent, Linking, Vibration } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Location from 'expo-location'
import * as Contacts from 'expo-contacts'
import * as Clipboard from 'expo-clipboard'
import { API_BASE_URL } from '../../../config/env'
import { apiRequest, getValidAccessToken } from '../../../api/client'
import { ChatMessage } from '../../../types/models'
import { useAuth } from '../../../auth/AuthContext'
import { useOnlineState } from '../../../hooks/useOnlineState'
import { enqueueOutbox } from '../../../offline/outbox'
import { VoiceRecorder } from '../../../services/voiceRecorder'
import { buildSendDraftSnapshot, toInvertedThreadItems } from '../message-thread-utils'
import {
  AttachmentDraft,
  ConversationResponse,
  ConversationsResponse,
  OptimisticMessage,
  RenderThreadItem,
  SendMutationInput,
  ThreadResponse,
} from '../types/message-thread-v2'

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
}

function inferMimeTypeFromName(fileName?: string | null, fallback = 'application/octet-stream'): string {
  const ext = String(fileName || '')
    .split('.')
    .pop()
    ?.trim()
    .toLowerCase()
  if (!ext) return fallback
  return MIME_BY_EXTENSION[ext] || fallback
}

function extFromMimeType(mimeType: string): string {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/heic') return 'heic'
  if (normalized === 'image/heif') return 'heif'
  if (normalized === 'video/mp4') return 'mp4'
  if (normalized === 'video/quicktime') return 'mov'
  if (normalized === 'video/x-m4v') return 'm4v'
  if (normalized === 'video/webm') return 'webm'
  if (normalized === 'video/3gpp') return '3gp'
  if (normalized === 'video/3gpp2') return '3g2'
  if (normalized === 'application/pdf') return 'pdf'
  if (normalized === 'application/msword') return 'doc'
  if (normalized === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (normalized === 'application/vnd.ms-excel') return 'xls'
  if (normalized === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (normalized === 'text/csv') return 'csv'
  if (normalized === 'application/vnd.ms-powerpoint') return 'ppt'
  if (normalized === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx'
  if (normalized === 'text/plain') return 'txt'
  return 'bin'
}

function ensureFileName(fileName: string | null | undefined, mimeType: string, prefix: string): string {
  const name = String(fileName || '').trim()
  if (name && name.includes('.')) return name
  return `${prefix}-${Date.now()}.${extFromMimeType(mimeType)}`
}

interface Params {
  conversationId: string
  jobContext?:
    | {
        jobId: string
        jobNumber: string
        jobName: string
      }
    | undefined
}

export function useMessageThreadControllerV2({ conversationId, jobContext }: Params) {
  const { user, token } = useAuth()
  const isOnline = useOnlineState()
  const queryClient = useQueryClient()
  const listRef = useRef<FlatList>(null)
  const [text, setText] = useState(jobContext ? `Regarding Job #${jobContext.jobNumber} - ${jobContext.jobName}\n` : '')
  const [isRecordingUi, setIsRecordingUi] = useState(false)
  const [recordingDurationMs, setRecordingDurationMs] = useState(0)
  const [recordingWillCancel, setRecordingWillCancel] = useState(false)
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([])
  const [replyFallbackByMessageId, setReplyFallbackByMessageId] = useState<Record<string, NonNullable<ChatMessage['replyTo']>>>({})
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null)
  const [showMessageOptions, setShowMessageOptions] = useState(false)
  const [messageActionTarget, setMessageActionTarget] = useState<ChatMessage | OptimisticMessage | null>(null)
  const [viewingMedia, setViewingMedia] = useState<{ uri: string; fileName?: string | null; kind: 'IMAGE' | 'VIDEO' } | null>(null)
  const [mediaDrafts, setMediaDrafts] = useState<AttachmentDraft[]>([])
  const voiceRecorderRef = useRef<VoiceRecorder>(new VoiceRecorder())
  const recordingStartedAtRef = useRef<number | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const pressSessionRef = useRef<number>(0)
  const stopInFlightRef = useRef(false)

  const conversationQuery = useQuery({
    queryKey: ['mobile-chat-conversation', conversationId],
    queryFn: () => apiRequest<ConversationResponse>(`/api/messages/conversations/${conversationId}`),
    refetchInterval: 30_000,
  })

  const conversationsQuery = useQuery({
    queryKey: ['mobile-chat-conversations'],
    queryFn: () => apiRequest<ConversationsResponse>('/api/messages/conversations'),
    refetchInterval: 20_000,
  })

  const threadQuery = useQuery({
    queryKey: ['mobile-chat-thread', conversationId],
    queryFn: () => apiRequest<ThreadResponse>(`/api/messages/conversations/${conversationId}/messages?limit=80`),
    refetchInterval: 8_000,
  })

  const conversation = conversationQuery.data?.conversation
  const listedConversation = conversationsQuery.data?.conversations?.find((item) => item.id === conversationId)
  const conversationType = listedConversation?.type || conversation?.type
  const isTeamChat = conversationType === 'TEAM'

  const uploadToMessages = useCallback(async (uri: string, mimeType: string) => {
    const accessToken = await getValidAccessToken()
    if (!accessToken) throw new Error('Authentication required')
    let copiedUploadUri: string | null = null
    let uploadUri = uri

    const needsUriCopy =
      uploadUri.startsWith('content://') ||
      uploadUri.startsWith('ph://') ||
      uploadUri.startsWith('assets-library://')
    if (needsUriCopy) {
      const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory
      if (!baseDir) throw new Error('Unable to prepare file for upload')
      copiedUploadUri = `${baseDir}chat-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await FileSystem.copyAsync({ from: uploadUri, to: copiedUploadUri })
      uploadUri = copiedUploadUri
    }

    const runUpload = async (tokenValue: string) => {
      const task = FileSystem.createUploadTask(
        `${API_BASE_URL}/api/uploads/messages`,
        uploadUri,
        {
          fieldName: 'file',
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          mimeType,
          headers: {
            Authorization: `Bearer ${tokenValue}`,
            Accept: 'application/json',
          },
        },
        () => {}
      )
      return task.uploadAsync()
    }

    let uploadResult = await runUpload(accessToken)
    if (uploadResult?.status === 401) {
      const refreshed = await getValidAccessToken(true)
      if (refreshed) uploadResult = await runUpload(refreshed)
    }
    if (!uploadResult || uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new Error(`Upload failed with status ${uploadResult?.status || 0}`)
    }
    const payload = JSON.parse(uploadResult.body || '{}')
    if (!payload?.url) throw new Error('Upload failed: missing URL')
    if (copiedUploadUri) void FileSystem.deleteAsync(copiedUploadUri, { idempotent: true }).catch(() => {})
    return payload as { url: string }
  }, [])

  useEffect(() => {
    apiRequest(`/api/messages/conversations/${conversationId}/read`, 'POST', {}).catch(() => {})
  }, [conversationId])

  useEffect(() => {
    voiceRecorderRef.current.ensurePermission(true).catch(() => {})
  }, [])

  useEffect(() => {
    if (!threadQuery.data?.messages) return
    const fallbackFromMatched: Record<string, NonNullable<ChatMessage['replyTo']>> = {}
    setOptimisticMessages((prev) => {
      const serverIds = new Set(threadQuery.data!.messages.map((m) => m.id))
      const remaining = prev.filter((opt) => {
        if (serverIds.has(opt.id)) return false
        const matched = threadQuery.data!.messages.find((m) => m.clientTempId === opt.clientTempId)
        if (matched) {
          if (!matched.replyTo && opt.replyTo) fallbackFromMatched[matched.id] = opt.replyTo
          return false
        }
        return true
      })
      return remaining
    })
    setReplyFallbackByMessageId((prev) => {
      const next = { ...prev }
      for (const [messageId, reply] of Object.entries(fallbackFromMatched)) next[messageId] = reply
      for (const message of threadQuery.data!.messages) if (message.replyTo) next[message.id] = message.replyTo
      return next
    })
  }, [threadQuery.data?.messages])

  const sendMutation = useMutation({
    mutationFn: async ({ clientTempId, outgoingText, outgoingDrafts, outgoingReplyTo }: SendMutationInput) => {
      const localAttachments = outgoingDrafts.filter((m) => m.localUri)
      const readyAttachments = outgoingDrafts.filter((m) => m.url)
      const trimmed = outgoingText.trim()
      if (!trimmed && localAttachments.length === 0 && readyAttachments.length === 0) return

      if (!isOnline) {
        await enqueueOutbox({
          id: `chat-${Date.now()}-${conversationId}`,
          type: 'message-send',
          payload: {
            conversationId,
            to: '',
            from: user?.id || '',
            body: trimmed,
            channel: conversationType === 'TEAM' ? 'TEAM' : 'DM',
            media: readyAttachments.map((a) => ({
              type: a.kind.toLowerCase(),
              url: a.url!,
              mimeType: a.mimeType,
              size: a.sizeBytes,
              filename: a.fileName,
            })),
          },
        })
        return
      }

      const uploaded: AttachmentDraft[] = [...readyAttachments]
      for (const attachment of localAttachments) {
        if (!attachment.localUri) continue
        const uploadMimeType =
          attachment.kind === 'VOICE'
            ? 'audio/mp4'
            : attachment.mimeType || inferMimeTypeFromName(attachment.fileName, 'application/octet-stream')
        const payload = await uploadToMessages(attachment.localUri, uploadMimeType)
        uploaded.push({ ...attachment, url: payload.url })
      }

      await apiRequest(`/api/messages/conversations/${conversationId}/messages`, 'POST', {
        text: trimmed,
        jobId: jobContext?.jobId || null,
        clientTempId,
        replyToMessageId: outgoingReplyTo?.id || null,
        replyToSenderName: outgoingReplyTo
          ? `${outgoingReplyTo.sender?.firstName || ''} ${outgoingReplyTo.sender?.lastName || ''}`.trim() ||
            outgoingReplyTo.sender?.email ||
            'Unknown'
          : null,
        replyToText:
          outgoingReplyTo?.text ||
          (outgoingReplyTo?.attachments?.[0]?.kind === 'VOICE'
            ? 'Voice note'
            : outgoingReplyTo?.attachments?.[0]?.kind === 'IMAGE'
              ? 'Photo'
              : outgoingReplyTo?.attachments?.[0]?.kind === 'VIDEO'
                ? 'Video'
                : outgoingReplyTo?.attachments?.[0]?.kind === 'LOCATION'
                  ? 'Location'
                  : outgoingReplyTo?.attachments?.[0]?.fileName || ''),
        replyToType: outgoingReplyTo?.type || null,
        attachments: uploaded.map((attachment) => ({
          kind: attachment.kind,
          url: attachment.url,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          durationMs: attachment.durationMs,
          latitude: attachment.latitude,
          longitude: attachment.longitude,
        })),
      })
    },
    onSuccess: async () => {
      setText('')
      setMediaDrafts([])
      setReplyTo(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-thread', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-conversations'] }),
      ])
    },
    onError: (error: any, variables) => {
      setOptimisticMessages((prev) =>
        prev.map((msg) => (msg.clientTempId === variables.clientTempId ? { ...msg, status: 'FAILED' as const } : msg))
      )
      Alert.alert('Error', error?.message || 'Message failed to send')
    },
  })

  const editMutation = useMutation({
    mutationFn: async ({ messageId, text: value }: { messageId: string; text: string }) =>
      apiRequest(`/api/messages/conversations/${conversationId}/messages/${messageId}`, 'PATCH', { text: value }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-thread', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-conversations'] }),
      ])
      setEditingMessage(null)
    },
    onError: (error: any) => Alert.alert('Edit failed', error?.message || 'Unable to edit this message.'),
  })

  const deleteMutation = useMutation({
    mutationFn: async ({ messageId, mode }: { messageId: string; mode: 'ME' | 'EVERYONE' }) =>
      apiRequest(`/api/messages/conversations/${conversationId}/messages/${messageId}`, 'DELETE', { mode }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-thread', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-conversations'] }),
      ])
    },
    onError: (error: any) => Alert.alert('Delete failed', error?.message || 'Unable to delete this message.'),
  })

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated })
    })
  }, [])

  const closeMessageOptions = useCallback(() => {
    setShowMessageOptions(false)
    setMessageActionTarget(null)
  }, [])

  const openDeleteActions = useCallback(
    (message: ChatMessage | OptimisticMessage) => {
      const isMine = message.senderId === user?.id
      const isOptimistic = 'isOptimistic' in message
      const deleteForMe = () => {
        if (isOptimistic) {
          setOptimisticMessages((prev) => prev.filter((m) => m.id !== message.id))
          return
        }
        deleteMutation.mutate({ messageId: message.id, mode: 'ME' })
      }
      if (isMine && !isOptimistic) {
        Alert.alert('Delete message', 'Choose delete option', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete for me', style: 'destructive', onPress: deleteForMe },
          { text: 'Delete for everyone', style: 'destructive', onPress: () => deleteMutation.mutate({ messageId: message.id, mode: 'EVERYONE' }) },
        ])
        return
      }
      Alert.alert('Delete message', 'Are you sure you want to delete this message?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteForMe },
      ])
    },
    [deleteMutation, user?.id]
  )

  const canCopyAction = Boolean(typeof messageActionTarget?.text === 'string' && messageActionTarget.text.trim())
  const canEditAction = Boolean(
    messageActionTarget &&
      messageActionTarget.senderId === user?.id &&
      !('isOptimistic' in messageActionTarget) &&
      !messageActionTarget.attachments?.length &&
      typeof messageActionTarget.text === 'string'
  )

  const handleSend = useCallback(() => {
    if (sendMutation.isPending || editMutation.isPending) return
    if (editingMessage) {
      if (mediaDrafts.length > 0) {
        Alert.alert('Edit message', 'Remove attachments before editing this message.')
        return
      }
      const trimmed = text.trim()
      if (!trimmed) {
        Alert.alert('Edit message', 'Message text cannot be empty.')
        return
      }
      editMutation.mutate({ messageId: editingMessage.id, text: trimmed })
      setText('')
      return
    }
    const { outgoingText, outgoingDrafts, outgoingReplyTo, trimmedText, nextText } = buildSendDraftSnapshot({
      text,
      mediaDrafts,
      replyTo,
    })
    if (!trimmedText && outgoingDrafts.length === 0) return
    const clientTempId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimisticId = `opt-${clientTempId}`
    const optimistic: OptimisticMessage = {
      id: optimisticId,
      clientTempId,
      senderId: user?.id || '',
      text: trimmedText || null,
      type: outgoingDrafts.length > 0 ? 'MEDIA' : 'TEXT',
      status: 'SENT',
      createdAt: new Date().toISOString(),
      attachments: outgoingDrafts.filter((m) => m.url).map((m) => ({
        kind: m.kind,
        url: m.url!,
        fileName: m.fileName || null,
        mimeType: m.mimeType || null,
        sizeBytes: m.sizeBytes || null,
        durationMs: m.durationMs || null,
        latitude: m.latitude || null,
        longitude: m.longitude || null,
      })),
      jobId: jobContext?.jobId || null,
      jobNumber: jobContext?.jobNumber || null,
      jobName: jobContext?.jobName || null,
      replyToMessageId: outgoingReplyTo?.id || null,
      replyTo: outgoingReplyTo
        ? {
            messageId: outgoingReplyTo.id,
            senderName:
              `${outgoingReplyTo.sender?.firstName || ''} ${outgoingReplyTo.sender?.lastName || ''}`.trim() ||
              outgoingReplyTo.sender?.email ||
              'Unknown',
            textPreview:
              outgoingReplyTo.text ||
              (outgoingReplyTo.attachments?.[0]?.kind === 'VOICE'
                ? 'Voice note'
                : outgoingReplyTo.attachments?.[0]?.kind === 'IMAGE'
                  ? 'Photo'
                  : outgoingReplyTo.attachments?.[0]?.kind === 'VIDEO'
                    ? 'Video'
                    : outgoingReplyTo.attachments?.[0]?.kind === 'LOCATION'
                      ? 'Location'
                      : outgoingReplyTo.attachments?.[0]?.fileName || ''),
            type: outgoingReplyTo.type,
            createdAt: outgoingReplyTo.createdAt,
          }
        : null,
      isOptimistic: true,
    }
    setText(nextText)
    setMediaDrafts([])
    setReplyTo(null)
    setOptimisticMessages((prev) => [...prev, optimistic])
    sendMutation.mutate({ clientTempId, outgoingText, outgoingDrafts, outgoingReplyTo })
    scrollToLatest(true)
  }, [sendMutation, editMutation, editingMessage, mediaDrafts, text, replyTo, jobContext, user?.id, scrollToLatest])

  const openAttachMenu = useCallback(() => setShowAttachMenu(true), [])
  const closeAttachMenu = useCallback(() => setShowAttachMenu(false), [])

  const pickFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) return Alert.alert('Permission required', 'Please grant access to your photo library.')
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.72, allowsMultipleSelection: false })
    if (result.canceled || result.assets.length === 0) return
    const asset = result.assets[0]
    const mimeType = asset.mimeType || inferMimeTypeFromName(asset.fileName, asset.type === 'video' ? 'video/mp4' : 'image/jpeg')
    setMediaDrafts((prev) => [...prev, { kind: mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE', localUri: asset.uri, mimeType, fileName: ensureFileName(asset.fileName, mimeType, 'chat'), sizeBytes: asset.fileSize || undefined }])
  }, [])

  const pickFromCamera = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) return Alert.alert('Permission required', 'Please grant camera access.')
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.75, videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium })
    if (result.canceled || result.assets.length === 0) return
    const asset = result.assets[0]
    const mimeType = asset.mimeType || inferMimeTypeFromName(asset.fileName, asset.type === 'video' ? 'video/mp4' : 'image/jpeg')
    setMediaDrafts((prev) => [...prev, { kind: mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE', localUri: asset.uri, mimeType, fileName: ensureFileName(asset.fileName, mimeType, 'camera'), sizeBytes: asset.fileSize || undefined }])
  }, [])

  const recordVideoFromCamera = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) return Alert.alert('Permission required', 'Please grant camera access.')
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], quality: 0.75, videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium, videoMaxDuration: 300 })
    if (result.canceled || result.assets.length === 0) return
    const asset = result.assets[0]
    const mimeType = asset.mimeType || inferMimeTypeFromName(asset.fileName, 'video/mp4')
    setMediaDrafts((prev) => [...prev, { kind: 'VIDEO', localUri: asset.uri, mimeType, fileName: ensureFileName(asset.fileName, mimeType, 'camera-video'), sizeBytes: asset.fileSize || undefined }])
  }, [])

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'image/*', 'video/*'], multiple: false, copyToCacheDirectory: true })
    if (result.canceled || result.assets.length === 0) return
    const file = result.assets[0]
    const mimeType = inferMimeTypeFromName(file.name, file.mimeType || 'application/octet-stream')
    setMediaDrafts((prev) => [...prev, { kind: mimeType.startsWith('image/') ? 'IMAGE' : mimeType.startsWith('video/') ? 'VIDEO' : 'FILE', localUri: file.uri, mimeType, fileName: ensureFileName(file.name, mimeType, 'file'), sizeBytes: file.size || undefined }])
  }, [])

  const pickContact = useCallback(async () => {
    const permission = await Contacts.requestPermissionsAsync()
    if (!permission.granted) return Alert.alert('Permission required', 'Please grant contacts access.')
    const picked = await Contacts.presentContactPickerAsync()
    if (!picked) return
    const phone = picked.phoneNumbers?.[0]?.number || ''
    const email = picked.emails?.[0]?.email || ''
    const name = [picked.firstName, picked.lastName].filter(Boolean).join(' ').trim() || 'Contact'
    const lines = [`Contact: ${name}`]
    if (phone) lines.push(`Phone: ${phone}`)
    if (email) lines.push(`Email: ${email}`)
    setText((prev) => `${prev.trim().length > 0 ? `${prev.trim()}\n` : ''}${lines.join('\n')}`)
  }, [])

  const shareLocation = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync()
    if (!permission.granted) return Alert.alert('Permission required', 'Location permission is required to share your location.')
    const location = await Location.getCurrentPositionAsync({})
    setMediaDrafts((prev) => [...prev, { kind: 'LOCATION', url: `https://maps.google.com/?q=${location.coords.latitude},${location.coords.longitude}`, latitude: location.coords.latitude, longitude: location.coords.longitude }])
  }, [])

  const runAttachMenuAction = useCallback((action: () => Promise<void>) => {
    closeAttachMenu()
    setTimeout(() => {
      void action().catch((error: any) => Alert.alert('Attachment error', error?.message || 'Unable to add attachment.'))
    }, 180)
  }, [closeAttachMenu])

  const MIN_VOICE_DURATION_MS = 450
  const CANCEL_DRAG_THRESHOLD = 56

  const clearDurationTicker = () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }
  }
  const resetRecordingUi = () => {
    clearDurationTicker()
    recordingStartedAtRef.current = null
    pressStartRef.current = null
    setRecordingDurationMs(0)
    setRecordingWillCancel(false)
    setIsRecordingUi(false)
  }

  const cancelRecording = useCallback(async () => {
    pressSessionRef.current = 0
    const recorder = voiceRecorderRef.current
    try {
      if (recorder.isRecording() || recorder.getPhase() === 'starting') await recorder.cancel()
    } finally {
      resetRecordingUi()
    }
  }, [])

  const sendVoiceMessage = useCallback(async (uri: string, durationMs: number) => {
    if (!token) return Alert.alert('Error', 'Authentication required. Please log in again.')
    const voiceFileName = `voice-${Date.now()}.m4a`
    const clientTempId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: OptimisticMessage = {
      id: `opt-${clientTempId}`,
      clientTempId,
      senderId: user?.id || '',
      text: null,
      type: 'MEDIA',
      status: 'SENT',
      createdAt: new Date().toISOString(),
      attachments: [{ kind: 'VOICE', url: uri, fileName: voiceFileName, mimeType: 'audio/m4a', sizeBytes: null, durationMs, latitude: null, longitude: null }],
      jobId: jobContext?.jobId || null,
      jobNumber: jobContext?.jobNumber || null,
      jobName: jobContext?.jobName || null,
      replyToMessageId: replyTo?.id || null,
      replyTo: replyTo
        ? {
            messageId: replyTo.id,
            senderName: `${replyTo.sender?.firstName || ''} ${replyTo.sender?.lastName || ''}`.trim() || replyTo.sender?.email || 'Unknown',
            textPreview: replyTo.text || replyTo.attachments?.[0]?.fileName || 'Attachment',
            type: replyTo.type,
            createdAt: replyTo.createdAt,
          }
        : null,
      isOptimistic: true,
    }
    setOptimisticMessages((prev) => [...prev, optimistic])
    scrollToLatest(true)
    try {
      const payload = await uploadToMessages(uri, 'audio/mp4')
      await apiRequest(`/api/messages/conversations/${conversationId}/messages`, 'POST', {
        text: null,
        jobId: jobContext?.jobId || null,
        clientTempId,
        replyToMessageId: replyTo?.id || null,
        replyToSenderName: replyTo ? `${replyTo.sender?.firstName || ''} ${replyTo.sender?.lastName || ''}`.trim() || replyTo.sender?.email || 'Unknown' : null,
        replyToText: replyTo?.text || replyTo?.attachments?.[0]?.fileName || 'Attachment',
        replyToType: replyTo?.type || null,
        attachments: [{ kind: 'VOICE', url: payload.url, fileName: voiceFileName, mimeType: 'audio/m4a', sizeBytes: null, durationMs, latitude: null, longitude: null }],
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-thread', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-conversations'] }),
      ])
      setReplyTo(null)
    } catch (error: any) {
      setOptimisticMessages((prev) => prev.map((msg) => (msg.clientTempId === clientTempId ? { ...msg, status: 'FAILED' as const } : msg)))
      Alert.alert('Upload error', error?.message || 'Failed to send voice note.')
    }
  }, [token, user?.id, jobContext, replyTo, scrollToLatest, uploadToMessages, conversationId, queryClient])

  const startRecording = useCallback(async (event: GestureResponderEvent) => {
    const recorder = voiceRecorderRef.current
    const sessionId = Date.now()
    pressSessionRef.current = sessionId
    pressStartRef.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }
    setRecordingWillCancel(false)
    setRecordingDurationMs(0)
    setIsRecordingUi(true)
    try {
      await recorder.start()
      if (pressSessionRef.current !== sessionId) {
        await recorder.cancel()
        resetRecordingUi()
        return
      }
      recordingStartedAtRef.current = Date.now()
      clearDurationTicker()
      durationIntervalRef.current = setInterval(() => {
        if (!recordingStartedAtRef.current) return
        setRecordingDurationMs(Date.now() - recordingStartedAtRef.current)
      }, 150)
    } catch (error: any) {
      await recorder.forceCleanup()
      resetRecordingUi()
      Alert.alert('Recording error', error?.message || 'Unable to start voice recording.')
    }
  }, [])

  const moveRecording = useCallback((event: GestureResponderEvent) => {
    if (!pressStartRef.current) return
    const dx = event.nativeEvent.pageX - pressStartRef.current.x
    const shouldCancel = dx < -CANCEL_DRAG_THRESHOLD
    if (shouldCancel !== recordingWillCancel) setRecordingWillCancel(shouldCancel)
  }, [recordingWillCancel])

  const stopRecording = useCallback(async (event: GestureResponderEvent) => {
    if (stopInFlightRef.current) return
    stopInFlightRef.current = true
    const recorder = voiceRecorderRef.current
    pressSessionRef.current = 0
    if (!recorder.isRecording()) {
      resetRecordingUi()
      stopInFlightRef.current = false
      return
    }
    const elapsed = recordingStartedAtRef.current ? Date.now() - recordingStartedAtRef.current : 0
    if (!recordingWillCancel && elapsed < MIN_VOICE_DURATION_MS) {
      stopInFlightRef.current = false
      return
    }
    const dragDx = pressStartRef.current ? event.nativeEvent.pageX - pressStartRef.current.x : 0
    if (recordingWillCancel || dragDx < -CANCEL_DRAG_THRESHOLD) {
      await cancelRecording()
      stopInFlightRef.current = false
      return
    }
    try {
      const result = await recorder.stop()
      resetRecordingUi()
      await sendVoiceMessage(result.uri, result.durationMs)
    } catch (error: any) {
      await recorder.forceCleanup()
      resetRecordingUi()
      Alert.alert('Error', error?.message || 'Failed to stop recording.')
    } finally {
      stopInFlightRef.current = false
    }
  }, [cancelRecording, recordingWillCancel, sendVoiceMessage])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && voiceRecorderRef.current.isRecording()) {
        cancelRecording().catch(() => {})
      }
    })
    return () => {
      sub.remove()
      cancelRecording().catch(() => {})
      clearDurationTicker()
    }
  }, [cancelRecording])

  const messages = useMemo(() => {
    const server = threadQuery.data?.messages || []
    return [...server, ...optimisticMessages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [threadQuery.data?.messages, optimisticMessages])

  const messagesWithDates = useMemo(() => {
    const result: RenderThreadItem[] = []
    let lastDate: Date | null = null
    for (const msg of messages) {
      const msgDate = new Date(msg.createdAt)
      const dateOnly = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate())
      if (!lastDate || dateOnly.getTime() !== lastDate.getTime()) {
        result.push({ type: 'DATE', date: dateOnly })
        lastDate = dateOnly
      }
      result.push(msg as RenderThreadItem)
    }
    return result
  }, [messages])

  const renderItems = useMemo(() => toInvertedThreadItems(messagesWithDates), [messagesWithDates])
  const messageIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    renderItems.forEach((item, index) => {
      if ('type' in item && item.type === 'DATE') return
      if ('id' in item) map.set(String(item.id), index)
    })
    return map
  }, [renderItems])

  const threadTitle = useMemo(() => {
    const normalizeTitle = (value?: string | null) => value?.trim() || ''
    const isPlaceholderTitle = (value: string) => ['conversation', 'direct message', 'dm', 'message'].includes(value.toLowerCase())
    if (conversationType === 'TEAM') {
      const teamTitle = normalizeTitle(listedConversation?.title) || normalizeTitle(conversation?.title)
      return teamTitle || 'Team Chat'
    }
    const otherUser = listedConversation?.otherUser
    if (otherUser) {
      const fullName = `${otherUser.firstName || ''} ${otherUser.lastName || ''}`.trim()
      if (fullName) return fullName
      if (otherUser.email) return otherUser.email
    }
    const preferredTitle = normalizeTitle(listedConversation?.title) || normalizeTitle(conversation?.title)
    if (preferredTitle && !isPlaceholderTitle(preferredTitle)) return preferredTitle
    if (conversationType === 'JOB_THREAD') return 'Job Thread'
    return 'Direct Message'
  }, [listedConversation, conversation, conversationType])

  return {
    listRef,
    text,
    setText,
    isRecordingUi,
    recordingDurationMs,
    recordingWillCancel,
    mediaDrafts,
    setMediaDrafts,
    replyTo,
    setReplyTo,
    editingMessage,
    setEditingMessage,
    renderItems,
    messageIndexMap,
    threadTitle,
    isTeamChat,
    otherUserAvatar: listedConversation?.otherUser?.avatar || null,
    replyFallbackByMessageId,
    sendMutation,
    editMutation,
    deleteMutation,
    showAttachMenu,
    setShowAttachMenu,
    showMessageOptions,
    setShowMessageOptions,
    messageActionTarget,
    setMessageActionTarget,
    viewingMedia,
    setViewingMedia,
    canCopyAction,
    canEditAction,
    openAttachMenu,
    closeAttachMenu,
    runAttachMenuAction,
    pickFromCamera,
    recordVideoFromCamera,
    pickFromLibrary,
    pickDocument,
    pickContact,
    shareLocation,
    handleSend,
    scrollToLatest,
    startRecording,
    moveRecording,
    stopRecording,
    cancelRecording,
    closeMessageOptions,
    openDeleteActions,
    openMessageActions: (message: ChatMessage | OptimisticMessage) => {
      setMessageActionTarget(message)
      setShowMessageOptions(true)
    },
    handleCopyAction: () => {
      if (!messageActionTarget || !canCopyAction) return
      void Clipboard.setStringAsync(messageActionTarget.text || '')
      closeMessageOptions()
    },
    handleEditAction: () => {
      if (!messageActionTarget || !canEditAction) return
      setReplyTo(null)
      setEditingMessage(messageActionTarget as ChatMessage)
      setText(messageActionTarget.text || '')
      closeMessageOptions()
    },
    handleDeleteAction: () => {
      if (!messageActionTarget) return
      const target = messageActionTarget
      closeMessageOptions()
      openDeleteActions(target)
    },
    isOnline,
    userId: user?.id,
  }
}
