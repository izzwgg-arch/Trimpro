import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  AppState,
  FlatList,
  GestureResponderEvent,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Location from 'expo-location'
import * as Contacts from 'expo-contacts'
import { SafeAreaView } from 'react-native-safe-area-context'
import { API_BASE_URL } from '../../config/env'
import { apiRequest, getValidAccessToken } from '../../api/client'
import { ChatMessage } from '../../types/models'
import { MessagesStackParamList } from '../../types/navigation'
import { useAuth } from '../../auth/AuthContext'
import { useOnlineState } from '../../hooks/useOnlineState'
import { enqueueOutbox } from '../../offline/outbox'
import { MessageBubble } from '../../components/chat/MessageBubble'
import { Composer } from '../../components/chat/Composer'
import { DateSeparator } from '../../components/chat/DateSeparator'
import { MediaViewer } from '../../components/chat/MediaViewer'
import { VoiceRecorder } from '../../services/voiceRecorder'
import { buildSendDraftSnapshot, toInvertedThreadItems } from './message-thread-utils'
import { colors, spacing, typography } from '../../theme/tokens'

type Props = NativeStackScreenProps<MessagesStackParamList, 'MessageThread'>

interface ThreadResponse {
  messages: ChatMessage[]
}

interface ConversationResponse {
  conversation: {
    id: string
    type: 'TEAM' | 'DM' | 'JOB_THREAD'
    title?: string | null
  }
}

interface ConversationsResponse {
  conversations: Array<{
    id: string
    type?: 'TEAM' | 'DM' | 'JOB_THREAD'
    title?: string | null
    otherUser?: {
      id: string
      firstName?: string | null
      lastName?: string | null
      email: string
      avatar?: string | null
    } | null
  }>
}

interface OptimisticMessage {
  id: string
  clientTempId: string
  senderId: string
  text?: string | null
  type: 'TEXT' | 'MEDIA' | 'VOICE' | 'LOCATION'
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  createdAt: string
  attachments?: Array<{
    kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'LOCATION'
    url: string
    fileName?: string | null
    mimeType?: string | null
    sizeBytes?: number | null
    durationMs?: number | null
    latitude?: number | null
    longitude?: number | null
  }>
  replyToMessageId?: string | null
  replyTo?: {
    messageId: string
    senderName: string
    textPreview: string
    type?: 'TEXT' | 'MEDIA' | 'VOICE' | 'LOCATION' | 'SYSTEM'
    createdAt?: string | null
  } | null
  jobId?: string | null
  jobNumber?: string | null
  jobName?: string | null
  isOptimistic: true
}

interface SendMutationInput {
  clientTempId: string
  outgoingText: string
  outgoingDrafts: Array<{
    kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'LOCATION'
    url?: string
    fileName?: string
    mimeType?: string
    sizeBytes?: number
    durationMs?: number
    latitude?: number
    longitude?: number
    localUri?: string
  }>
  outgoingReplyTo: ChatMessage | null
}

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

export function MessageThreadScreen({ route, navigation }: Props) {
  const { conversationId, jobContext } = route.params
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
  const voiceRecorderRef = useRef<VoiceRecorder>(new VoiceRecorder())
  const recordingStartedAtRef = useRef<number | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const pressSessionRef = useRef<number>(0)
  const stopInFlightRef = useRef(false)
  const [viewingMedia, setViewingMedia] = useState<{ uri: string; fileName?: string | null; kind: 'IMAGE' | 'VIDEO' } | null>(null)
  const [mediaDrafts, setMediaDrafts] = useState<
    Array<{
      kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'LOCATION'
      url?: string
      fileName?: string
      mimeType?: string
      sizeBytes?: number
      durationMs?: number
      latitude?: number
      longitude?: number
      localUri?: string
      uploadProgress?: number
    }>
  >([])

  const uploadToMessages = useCallback(
    async (uri: string, mimeType: string) => {
      const token = await getValidAccessToken()
      if (!token) throw new Error('Authentication required')

      const runUpload = async (accessToken: string) => {
        const task = FileSystem.createUploadTask(
          `${API_BASE_URL}/api/uploads/messages`,
          uri,
          {
            fieldName: 'file',
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.MULTIPART,
            mimeType,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
          () => {}
        )
        return task.uploadAsync()
      }

      let uploadResult = await runUpload(token)
      if (uploadResult?.status === 401) {
        const refreshedToken = await getValidAccessToken(true)
        if (refreshedToken) {
          uploadResult = await runUpload(refreshedToken)
        }
      }
      if (!uploadResult || uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Upload failed with status ${uploadResult?.status || 0}`)
      }
      const payload = JSON.parse(uploadResult.body || '{}')
      if (!payload?.url) {
        throw new Error('Upload failed: missing URL')
      }
      return payload as { url: string }
    },
    []
  )

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

  useEffect(() => {
    apiRequest(`/api/messages/conversations/${conversationId}/read`, 'POST', {}).catch(() => {})
  }, [conversationId])

  useEffect(() => {
    voiceRecorderRef.current.ensurePermission(true).catch(() => {})
  }, [])

  useEffect(() => {
    if (threadQuery.data?.messages) {
      const fallbackFromMatched: Record<string, NonNullable<ChatMessage['replyTo']>> = {}
      setOptimisticMessages((prev) => {
        const serverIds = new Set(threadQuery.data!.messages.map((m) => m.id))
        const remaining = prev.filter((opt) => {
          if (serverIds.has(opt.id)) return false
          const matched = threadQuery.data!.messages.find((m) => m.clientTempId === opt.clientTempId)
          if (matched) {
            if (!matched.replyTo && opt.replyTo) {
              fallbackFromMatched[matched.id] = opt.replyTo
            }
            return false
          }
          return true
        })
        return remaining
      })
      setReplyFallbackByMessageId((prev) => {
        const next = { ...prev }
        for (const [messageId, reply] of Object.entries(fallbackFromMatched)) {
          next[messageId] = reply
        }
        for (const message of threadQuery.data!.messages) {
          if (message.replyTo) {
            next[message.id] = message.replyTo
          }
        }
        return next
      })
    }
  }, [threadQuery.data?.messages])

  useEffect(() => {
    if (!threadQuery.data?.messages || optimisticMessages.length === 0) return
    const nextFallback: Record<string, NonNullable<ChatMessage['replyTo']>> = {}
    for (const optimistic of optimisticMessages) {
      if (!optimistic.replyTo) continue
      const matched = threadQuery.data.messages.find((message) => message.clientTempId === optimistic.clientTempId)
      if (matched && !matched.replyTo) {
        nextFallback[matched.id] = optimistic.replyTo
      }
    }
    if (Object.keys(nextFallback).length > 0) {
      setReplyFallbackByMessageId((prev) => ({ ...prev, ...nextFallback }))
    }
  }, [threadQuery.data?.messages, optimisticMessages])

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

      const uploaded: typeof readyAttachments = [...readyAttachments]
      for (const attachment of localAttachments) {
        if (!attachment.localUri || !token) continue
        try {
          const uploadMimeType =
            attachment.kind === 'VOICE'
              ? 'audio/mp4'
              : attachment.mimeType || inferMimeTypeFromName(attachment.fileName, 'application/octet-stream')
          const payload = await uploadToMessages(attachment.localUri, uploadMimeType)
          uploaded.push({
            ...attachment,
            url: payload.url,
          })
        } catch (error) {
          console.error('Upload error:', error)
          throw error
        }
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
      apiRequest(`/api/messages/conversations/${conversationId}/read`, 'POST', {}).catch(() => {})
    },
    onError: (error: any, variables: SendMutationInput) => {
      setOptimisticMessages((prev) =>
        prev.map((msg) => (msg.clientTempId === variables.clientTempId ? { ...msg, status: 'FAILED' as const } : msg))
      )
      Alert.alert('Error', error?.message || 'Message failed to send')
    },
  })

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated })
    })
  }, [])

  const handleSend = () => {
    const { outgoingText, outgoingDrafts, outgoingReplyTo, trimmedText, nextText } = buildSendDraftSnapshot({
      text,
      mediaDrafts,
      replyTo,
    })
    const trimmed = trimmedText
    if (!trimmed && outgoingDrafts.length === 0) return

    const clientTempId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimisticId = `opt-${clientTempId}`

    const optimistic: OptimisticMessage = {
      id: optimisticId,
      clientTempId,
      senderId: user?.id || '',
      text: trimmed || null,
      type: outgoingDrafts.length > 0 ? 'MEDIA' : 'TEXT',
      status: 'SENT',
      createdAt: new Date().toISOString(),
      attachments: outgoingDrafts
        .filter((m) => m.url)
        .map((m) => ({
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
    setOptimisticMessages((prev) => [...prev, optimistic])
    sendMutation.mutate({ clientTempId, outgoingText, outgoingDrafts, outgoingReplyTo })
    scrollToLatest(true)
  }

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please grant access to your photo library.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.72,
      allowsMultipleSelection: false,
    })
    if (result.canceled || result.assets.length === 0) return
    const asset = result.assets[0]
    const mimeType =
      asset.mimeType ||
      inferMimeTypeFromName(asset.fileName, asset.type === 'video' ? 'video/mp4' : 'image/jpeg')
    setMediaDrafts((prev) => [
      ...prev,
      {
        kind: mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE',
        localUri: asset.uri,
        mimeType,
        fileName: ensureFileName(asset.fileName, mimeType, 'chat'),
        sizeBytes: asset.fileSize || undefined,
      },
    ])
  }

  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please grant camera access.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.75,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    })
    if (result.canceled || result.assets.length === 0) return
    const asset = result.assets[0]
    const mimeType =
      asset.mimeType ||
      inferMimeTypeFromName(asset.fileName, asset.type === 'video' ? 'video/mp4' : 'image/jpeg')
    setMediaDrafts((prev) => [
      ...prev,
      {
        kind: mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE',
        localUri: asset.uri,
        mimeType,
        fileName: ensureFileName(asset.fileName, mimeType, 'camera'),
        sizeBytes: asset.fileSize || undefined,
      },
    ])
  }

  const recordVideoFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please grant camera access.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      quality: 0.75,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      videoMaxDuration: 300,
    })
    if (result.canceled || result.assets.length === 0) return
    const asset = result.assets[0]
    const mimeType =
      asset.mimeType ||
      inferMimeTypeFromName(asset.fileName, asset.type === 'video' ? 'video/mp4' : 'image/jpeg')
    setMediaDrafts((prev) => [
      ...prev,
      {
        kind: 'VIDEO',
        localUri: asset.uri,
        mimeType,
        fileName: ensureFileName(asset.fileName, mimeType, 'camera-video'),
        sizeBytes: asset.fileSize || undefined,
      },
    ])
  }

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'image/*',
        'video/*',
      ],
      multiple: false,
      copyToCacheDirectory: true,
    })
    if (result.canceled || result.assets.length === 0) return
    const file = result.assets[0]
    const mimeType = inferMimeTypeFromName(file.name, file.mimeType || 'application/octet-stream')
    setMediaDrafts((prev) => [
      ...prev,
      {
        kind: mimeType.startsWith('image/') ? 'IMAGE' : mimeType.startsWith('video/') ? 'VIDEO' : 'FILE',
        localUri: file.uri,
        mimeType,
        fileName: ensureFileName(file.name, mimeType, 'file'),
        sizeBytes: file.size || undefined,
      },
    ])
  }

  const pickContact = async () => {
    const permission = await Contacts.requestPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please grant contacts access.')
      return
    }
    const picked = await Contacts.presentContactPickerAsync()
    if (!picked) return
    const phone = picked.phoneNumbers?.[0]?.number || ''
    const email = picked.emails?.[0]?.email || ''
    const name = [picked.firstName, picked.lastName].filter(Boolean).join(' ').trim() || 'Contact'
    const cardLines = [`Contact: ${name}`]
    if (phone) cardLines.push(`Phone: ${phone}`)
    if (email) cardLines.push(`Email: ${email}`)
    setText((prev) => {
      const prefix = prev.trim().length > 0 ? `${prev.trim()}\n` : ''
      return `${prefix}${cardLines.join('\n')}`
    })
  }

  const shareLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Permission required', 'Location permission is required to share your location.')
      return
    }
    const location = await Location.getCurrentPositionAsync({})
    setMediaDrafts((prev) => [
      ...prev,
      {
        kind: 'LOCATION',
        url: `https://maps.google.com/?q=${location.coords.latitude},${location.coords.longitude}`,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      },
    ])
  }

  const openAttachMenu = () => setShowAttachMenu(true)
  const closeAttachMenu = () => setShowAttachMenu(false)

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

  const sendVoiceMessage = async (uri: string, durationMs: number) => {
    if (!token) {
      Alert.alert('Error', 'Authentication required. Please log in again.')
      return
    }

    const voiceFileName = `voice-${Date.now()}.m4a`
    const clientTempId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimisticId = `opt-${clientTempId}`

    const optimistic: OptimisticMessage = {
      id: optimisticId,
      clientTempId,
      senderId: user?.id || '',
      text: null,
      type: 'MEDIA',
      status: 'SENT',
      createdAt: new Date().toISOString(),
      attachments: [
        {
          kind: 'VOICE',
          url: uri,
          fileName: voiceFileName,
          mimeType: 'audio/m4a',
          sizeBytes: null,
          durationMs,
          latitude: null,
          longitude: null,
        },
      ],
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
        attachments: [
          {
            kind: 'VOICE',
            url: payload.url,
            fileName: voiceFileName,
            mimeType: 'audio/m4a',
            sizeBytes: null,
            durationMs,
            latitude: null,
            longitude: null,
          },
        ],
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-thread', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-conversations'] }),
      ])
      setReplyTo(null)
      apiRequest(`/api/messages/conversations/${conversationId}/read`, 'POST', {}).catch(() => {})
    } catch (error: any) {
      console.error('Voice send failed', error, error?.stack)
      setOptimisticMessages((prev) =>
        prev.map((msg) => (msg.clientTempId === clientTempId ? { ...msg, status: 'FAILED' as const } : msg))
      )
      Alert.alert('Upload error', error?.message || 'Failed to send voice note.')
    }
  }

  const startRecording = async (event: GestureResponderEvent) => {
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
        // Press ended before startup completed.
        await recorder.cancel()
        resetRecordingUi()
        return
      }

      recordingStartedAtRef.current = Date.now()
      setIsRecordingUi(true)
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
  }

  const moveRecording = (event: GestureResponderEvent) => {
    if (!pressStartRef.current) return
    const dx = event.nativeEvent.pageX - pressStartRef.current.x
    const shouldCancel = dx < -CANCEL_DRAG_THRESHOLD
    if (shouldCancel !== recordingWillCancel) {
      setRecordingWillCancel(shouldCancel)
    }
  }

  const cancelRecording = async () => {
    pressSessionRef.current = 0
    const recorder = voiceRecorderRef.current
    try {
      if (recorder.isRecording() || recorder.getPhase() === 'starting') {
        await recorder.cancel()
      }
    } catch {
    } finally {
      resetRecordingUi()
    }
  }

  const stopRecording = async (event: GestureResponderEvent) => {
    if (stopInFlightRef.current) return
    stopInFlightRef.current = true
    const recorder = voiceRecorderRef.current
    pressSessionRef.current = 0

    // Start never completed; nothing to stop, ensure cleanup and exit.
    if (!recorder.isRecording()) {
      resetRecordingUi()
      stopInFlightRef.current = false
      return
    }

    const elapsed = recordingStartedAtRef.current ? Date.now() - recordingStartedAtRef.current : 0
    // Some Android devices can emit an early synthetic release while still holding.
    // Ignore very short non-cancel releases so hold-to-record remains stable.
    if (!recordingWillCancel && elapsed < MIN_VOICE_DURATION_MS) {
      stopInFlightRef.current = false
      return
    }
    const dragDx = pressStartRef.current ? event.nativeEvent.pageX - pressStartRef.current.x : 0
    const shouldCancel = recordingWillCancel || dragDx < -CANCEL_DRAG_THRESHOLD
    if (shouldCancel) {
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
  }

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // Android can emit transient inactive/pause events during touch interactions.
      // Only force-cancel when app truly goes to background.
      if (state === 'background' && voiceRecorderRef.current.isRecording()) {
        cancelRecording().catch(() => {})
      }
    })
    return () => {
      sub.remove()
      cancelRecording().catch(() => {})
      clearDurationTicker()
    }
  }, [])

  const messages = useMemo(() => {
    const server = threadQuery.data?.messages || []
    const all = [...server, ...optimisticMessages]
    return all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [threadQuery.data?.messages, optimisticMessages])

  const messagesWithDates = useMemo(() => {
    const result: Array<ChatMessage | OptimisticMessage | { type: 'DATE'; date: Date }> = []
    let lastDate: Date | null = null
    for (const msg of messages) {
      const msgDate = new Date(msg.createdAt)
      const dateOnly = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate())
      if (!lastDate || dateOnly.getTime() !== lastDate.getTime()) {
        result.push({ type: 'DATE', date: dateOnly })
        lastDate = dateOnly
      }
      result.push(msg)
    }
    return result
  }, [messages])
  const renderItems = useMemo(() => toInvertedThreadItems(messagesWithDates), [messagesWithDates])
  const messageIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    renderItems.forEach((item, index) => {
      if ('type' in item && item.type === 'DATE') return
      if ('id' in item) {
        map.set(String(item.id), index)
      }
    })
    return map
  }, [renderItems])

  const conversation = conversationQuery.data?.conversation
  const listedConversation = conversationsQuery.data?.conversations?.find((item) => item.id === conversationId)
  const conversationType = listedConversation?.type || conversation?.type
  const isTeamChat = conversationType === 'TEAM'
  const threadTitle = useMemo(() => {
    const normalizeTitle = (value?: string | null) => value?.trim() || ''
    const isPlaceholderTitle = (value: string) =>
      ['conversation', 'direct message', 'dm', 'message'].includes(value.toLowerCase())

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
  const otherUserAvatar = listedConversation?.otherUser?.avatar || null

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </Pressable>
          {!isTeamChat && otherUserAvatar ? <Image source={{ uri: otherUserAvatar }} style={styles.headerAvatar} /> : null}
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>{threadTitle}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.headerIconButton}>
              <Ionicons name="videocam-outline" size={20} color={colors.textPrimary} />
            </Pressable>
            <Pressable style={styles.headerIconButton}>
              <Ionicons name="call-outline" size={19} color={colors.textPrimary} />
            </Pressable>
            <Pressable style={styles.headerIconButton}>
              <Ionicons name="ellipsis-vertical" size={18} color={colors.textPrimary} />
            </Pressable>
          </View>
        </View>

        <FlatList
          ref={listRef}
          data={renderItems}
          keyExtractor={(item, index) => {
            if ('type' in item && item.type === 'DATE') {
              return `date-${item.date.toISOString()}`
            }
            return 'id' in item ? item.id : `opt-${index}`
          }}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          inverted
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            if ('type' in item && item.type === 'DATE') {
              return <DateSeparator date={item.date} />
            }
            const message = item as ChatMessage | OptimisticMessage
            const isMine = message.senderId === user?.id
            const resolvedReplyTo = message.replyTo || replyFallbackByMessageId[message.id]
            return (
              <MessageBubble
                message={{ ...(message as ChatMessage), replyTo: resolvedReplyTo } as ChatMessage}
                isMine={isMine}
                showSender={isTeamChat && !isMine}
                onSwipeReply={(swipedMessage) => {
                  setReplyTo(swipedMessage)
                  Vibration.vibrate(10)
                }}
                onReplyPress={(messageId) => {
                  const targetIndex = messageIndexMap.get(messageId)
                  if (typeof targetIndex === 'number') {
                    listRef.current?.scrollToIndex({ index: targetIndex, animated: true, viewPosition: 0.2 })
                  }
                }}
                onJobPress={(jobId) => Linking.openURL(`trimpro://jobs/${jobId}`)}
                onImagePress={(uri, fileName) => {
                  const attachment = message.attachments?.find((a) => a.url === uri)
                  if (attachment?.kind === 'IMAGE') {
                    setViewingMedia({ uri, fileName, kind: 'IMAGE' })
                  } else if (attachment?.kind === 'VIDEO') {
                    setViewingMedia({ uri, fileName, kind: 'VIDEO' })
                  }
                }}
                onLongPress={() => {
                  if ('isOptimistic' in message && message.status === 'FAILED') {
                    Alert.alert('Retry', 'Would you like to retry sending this message?', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Retry',
                        onPress: () => {
                          setOptimisticMessages((prev) => prev.filter((m) => m.id !== message.id))
                          sendMutation.mutate({
                            clientTempId: message.clientTempId,
                            outgoingText: message.text || '',
                            outgoingDrafts: (message.attachments || []).map((attachment) => ({
                              kind: attachment.kind,
                              url: attachment.url,
                              fileName: attachment.fileName || undefined,
                              mimeType: attachment.mimeType || undefined,
                              sizeBytes: attachment.sizeBytes || undefined,
                              durationMs: attachment.durationMs || undefined,
                              latitude: attachment.latitude || undefined,
                              longitude: attachment.longitude || undefined,
                            })),
                            outgoingReplyTo: null,
                          })
                        },
                      },
                    ])
                  }
                }}
              />
            )
          }}
        />

        <View style={styles.composerDock}>
          <Composer
            text={text}
            onChangeText={setText}
            onSend={handleSend}
            onOpenMenu={openAttachMenu}
            onVoiceStart={startRecording}
            onVoiceMove={moveRecording}
            onVoiceStop={stopRecording}
            onVoiceCancel={cancelRecording}
            attachments={mediaDrafts}
            onRemoveAttachment={(index) => setMediaDrafts((prev) => prev.filter((_, i) => i !== index))}
            recording={isRecordingUi}
            recordingDurationMs={recordingDurationMs}
            recordingWillCancel={recordingWillCancel}
            replyPreview={
              replyTo
                ? {
                    senderName: `${replyTo.sender?.firstName || ''} ${replyTo.sender?.lastName || ''}`.trim() || replyTo.sender?.email || 'Unknown',
                    textPreview: replyTo.text || replyTo.attachments?.[0]?.fileName || replyTo.attachments?.[0]?.kind || '',
                  }
                : null
            }
            onClearReply={() => setReplyTo(null)}
            sending={sendMutation.isPending}
            disabled={!isOnline}
            bottomInset={0}
          />
        </View>
      </KeyboardAvoidingView>

      {viewingMedia && (
        <MediaViewer
          visible={!!viewingMedia}
          uri={viewingMedia.uri}
          fileName={viewingMedia.fileName}
          kind={viewingMedia.kind}
          onClose={() => setViewingMedia(null)}
        />
      )}
      <Modal visible={showAttachMenu} transparent animationType="slide" onRequestClose={closeAttachMenu}>
        <Pressable style={styles.menuBackdrop} onPress={closeAttachMenu}>
          <Pressable style={styles.menuSheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.menuTitle}>Share</Text>
            <ScrollView>
              <Pressable style={styles.menuItem} onPress={() => { closeAttachMenu(); pickFromCamera().catch(() => null) }}>
                <Ionicons name="camera-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.menuItemText}>Camera</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={() => { closeAttachMenu(); recordVideoFromCamera().catch(() => null) }}>
                <Ionicons name="videocam-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.menuItemText}>Record Video</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={() => { closeAttachMenu(); pickFromLibrary().catch(() => null) }}>
                <Ionicons name="images-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.menuItemText}>Photo & Video Library</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={() => { closeAttachMenu(); pickDocument().catch(() => null) }}>
                <Ionicons name="document-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.menuItemText}>Document</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={() => { closeAttachMenu(); pickContact().catch(() => null) }}>
                <Ionicons name="person-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.menuItemText}>Contact</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={() => { closeAttachMenu(); shareLocation().catch(() => null) }}>
                <Ionicons name="location-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.menuItemText}>Location</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  backButton: {
    padding: spacing.xs,
    marginRight: spacing.xs,
  },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: spacing.xs,
  },
  headerContent: {
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  composerDock: {
    backgroundColor: colors.surface,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    maxHeight: '70%',
  },
  menuTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 13,
  },
  menuItemText: {
    ...typography.body,
    color: colors.textPrimary,
  },
})
