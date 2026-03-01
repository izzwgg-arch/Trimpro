import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  AppState,
  FlatList,
  GestureResponderEvent,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Location from 'expo-location'
import { SafeAreaView } from 'react-native-safe-area-context'
import { API_BASE_URL } from '../../config/env'
import { apiRequest } from '../../api/client'
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
  jobId?: string | null
  jobNumber?: string | null
  jobName?: string | null
  isOptimistic: true
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
  const voiceRecorderRef = useRef<VoiceRecorder>(new VoiceRecorder())
  const recordingStartedAtRef = useRef<number | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const pressSessionRef = useRef<number>(0)
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
    if (threadQuery.data?.messages) {
      setOptimisticMessages((prev) => {
        const serverIds = new Set(threadQuery.data!.messages.map((m) => m.id))
        return prev.filter((opt) => {
          if (serverIds.has(opt.id)) return false
          const matched = threadQuery.data!.messages.find((m) => m.clientTempId === opt.clientTempId)
          if (matched) {
            return false
          }
          return true
        })
      })
    }
  }, [threadQuery.data?.messages])

  const sendMutation = useMutation({
    mutationFn: async (clientTempId: string) => {
      const localAttachments = mediaDrafts.filter((m) => m.localUri)
      const readyAttachments = mediaDrafts.filter((m) => m.url)
      const trimmed = text.trim()
      if (!trimmed && localAttachments.length === 0 && readyAttachments.length === 0) return

      if (!isOnline) {
        await enqueueOutbox({
          id: `chat-${Date.now()}-${conversationId}`,
          type: 'chat-message-send',
          payload: {
            conversationId,
            text: trimmed,
            clientTempId,
            jobId: jobContext?.jobId || null,
            attachments: readyAttachments.map((a) => ({
              kind: a.kind,
              url: a.url!,
              fileName: a.fileName,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              durationMs: a.durationMs,
              latitude: a.latitude,
              longitude: a.longitude,
            })),
          },
        })
        return
      }

      const uploaded: typeof readyAttachments = [...readyAttachments]
      for (const attachment of localAttachments) {
        if (!attachment.localUri || !token) continue
        try {
          const uploadResult = await FileSystem.uploadAsync(`${API_BASE_URL}/api/uploads/messages`, attachment.localUri, {
            fieldName: 'file',
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.MULTIPART,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            },
            mimeType: attachment.mimeType || 'application/octet-stream',
          })
          if (uploadResult.status < 200 || uploadResult.status >= 300) {
            throw new Error('Upload failed')
          }
          const payload = JSON.parse(uploadResult.body)
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-thread', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-chat-conversations'] }),
      ])
      apiRequest(`/api/messages/conversations/${conversationId}/read`, 'POST', {}).catch(() => {})
    },
    onError: (error: any, clientTempId: string) => {
      setOptimisticMessages((prev) =>
        prev.map((msg) => (msg.clientTempId === clientTempId ? { ...msg, status: 'FAILED' as const } : msg))
      )
      Alert.alert('Error', error?.message || 'Message failed to send')
    },
  })

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated })
    })
  }, [])

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed && mediaDrafts.length === 0) return

    const clientTempId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimisticId = `opt-${clientTempId}`

    const optimistic: OptimisticMessage = {
      id: optimisticId,
      clientTempId,
      senderId: user?.id || '',
      text: trimmed || null,
      type: mediaDrafts.length > 0 ? 'MEDIA' : 'TEXT',
      status: 'SENT',
      createdAt: new Date().toISOString(),
      attachments: mediaDrafts
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
      isOptimistic: true,
    }

    setOptimisticMessages((prev) => [...prev, optimistic])
    sendMutation.mutate(clientTempId)
    scrollToLatest(true)
  }

  const pickMedia = async () => {
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
    const mimeType = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg')
    setMediaDrafts((prev) => [
      ...prev,
      {
        kind: mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE',
        localUri: asset.uri,
        mimeType,
        fileName: asset.fileName || `chat-${Date.now()}`,
        sizeBytes: asset.fileSize || undefined,
      },
    ])
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

  const MIN_VOICE_DURATION_MS = 450
  const CANCEL_DRAG_THRESHOLD = 72

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
      isOptimistic: true,
    }

    setOptimisticMessages((prev) => [...prev, optimistic])
    scrollToLatest(true)

    try {
      const uploadResult = await FileSystem.uploadAsync(`${API_BASE_URL}/api/uploads/messages`, uri, {
        fieldName: 'file',
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        mimeType: 'audio/m4a',
      })

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Upload failed with status ${uploadResult.status}`)
      }

      const payload = JSON.parse(uploadResult.body)
      await apiRequest(`/api/messages/conversations/${conversationId}/messages`, 'POST', {
        text: null,
        jobId: jobContext?.jobId || null,
        clientTempId,
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

    try {
      if (__DEV__) console.log('[voice-ui] onPressIn -> start request')
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
      console.error('startRecording error', error, error?.stack)
      await recorder.forceCleanup()
      resetRecordingUi()
      Alert.alert('Recording error', error?.message || 'Unable to start voice recording.')
    }
  }

  const moveRecording = (event: GestureResponderEvent) => {
    if (!isRecordingUi || !pressStartRef.current) return
    const dx = event.nativeEvent.pageX - pressStartRef.current.x
    const dy = event.nativeEvent.pageY - pressStartRef.current.y
    const shouldCancel = dx < -CANCEL_DRAG_THRESHOLD || dy < -CANCEL_DRAG_THRESHOLD
    if (shouldCancel !== recordingWillCancel) {
      setRecordingWillCancel(shouldCancel)
    }
  }

  const cancelRecording = async () => {
    pressSessionRef.current = 0
    const recorder = voiceRecorderRef.current
    try {
      await recorder.cancel()
    } catch (error: any) {
      console.error('cancelRecording error', error, error?.stack)
    } finally {
      resetRecordingUi()
    }
  }

  const stopRecording = async (_event: GestureResponderEvent) => {
    const recorder = voiceRecorderRef.current
    pressSessionRef.current = 0

    // Start never completed; nothing to stop, ensure cleanup and exit.
    if (!recorder.isRecording()) {
      await cancelRecording()
      return
    }

    const elapsed = recordingStartedAtRef.current ? Date.now() - recordingStartedAtRef.current : 0
    const shouldCancel = recordingWillCancel || elapsed < MIN_VOICE_DURATION_MS
    if (shouldCancel) {
      await cancelRecording()
      return
    }

    try {
      const result = await recorder.stop()
      resetRecordingUi()
      await sendVoiceMessage(result.uri, result.durationMs)
    } catch (error: any) {
      console.error('stopRecording error', error, error?.stack)
      await recorder.forceCleanup()
      resetRecordingUi()
      Alert.alert('Error', error?.message || 'Failed to stop recording.')
    }
  }

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && (isRecordingUi || voiceRecorderRef.current.isRecording())) {
        cancelRecording().catch(() => {})
      }
    })
    return () => {
      sub.remove()
      cancelRecording().catch(() => {})
      clearDurationTicker()
    }
  }, [isRecordingUi])

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
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>{threadTitle}</Text>
            <Text style={styles.headerSubtitle}>{isTeamChat ? 'Team Chat' : 'Direct Message'}</Text>
          </View>
          <Pressable style={styles.menuButton}>
            <Ionicons name="ellipsis-vertical" size={20} color={colors.textPrimary} />
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={messagesWithDates}
          keyExtractor={(item, index) => {
            if ('type' in item && item.type === 'DATE') {
              return `date-${item.date.toISOString()}`
            }
            return 'id' in item ? item.id : `opt-${index}`
          }}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onContentSizeChange={() => scrollToLatest(false)}
          inverted={false}
          renderItem={({ item }) => {
            if ('type' in item && item.type === 'DATE') {
              return <DateSeparator date={item.date} />
            }
            const message = item as ChatMessage | OptimisticMessage
            const isMine = message.senderId === user?.id
            return (
              <MessageBubble
                message={message as ChatMessage}
                isMine={isMine}
                showSender={isTeamChat && !isMine}
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
                          sendMutation.mutate(message.clientTempId)
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
            onAttach={pickMedia}
            onLocation={shareLocation}
            onVoiceStart={startRecording}
            onVoiceMove={moveRecording}
            onVoiceStop={stopRecording}
            onVoiceCancel={cancelRecording}
            attachments={mediaDrafts}
            onRemoveAttachment={(index) => setMediaDrafts((prev) => prev.filter((_, i) => i !== index))}
            recording={isRecordingUi}
            recordingDurationMs={recordingDurationMs}
            recordingWillCancel={recordingWillCancel}
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
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  backButton: {
    padding: spacing.xs,
    marginRight: spacing.xs,
  },
  headerContent: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  menuButton: {
    padding: spacing.xs,
  },
  listContent: {
    paddingVertical: spacing.md,
    paddingBottom: spacing.xs,
  },
  composerDock: {
    backgroundColor: colors.surface,
  },
})
