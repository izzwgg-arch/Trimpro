import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Linking,
} from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Location from 'expo-location'
import { Audio } from 'expo-av'
import { API_BASE_URL, BRAND } from '../../config/env'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { ChatMessage } from '../../types/models'
import { MessagesStackParamList } from '../../types/navigation'
import { useAuth } from '../../auth/AuthContext'
import { useOnlineState } from '../../hooks/useOnlineState'
import { enqueueOutbox } from '../../offline/outbox'

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

function senderName(message: ChatMessage) {
  const sender = message.sender
  if (!sender) return 'Unknown'
  const value = `${sender.firstName || ''} ${sender.lastName || ''}`.trim()
  return value || sender.email
}

export function MessageThreadScreen({ route }: Props) {
  const { conversationId, jobContext } = route.params
  const { user, token } = useAuth()
  const isOnline = useOnlineState()
  const queryClient = useQueryClient()
  const [text, setText] = useState(jobContext ? `Regarding Job #${jobContext.jobNumber} - ${jobContext.jobName}\n` : '')
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState<Audio.Recording | null>(null)
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
    }>
  >([])

  const conversationQuery = useQuery({
    queryKey: ['mobile-chat-conversation', conversationId],
    queryFn: () => apiRequest<ConversationResponse>(`/api/messages/conversations/${conversationId}`),
    refetchInterval: 30_000,
  })

  const threadQuery = useQuery({
    queryKey: ['mobile-chat-thread', conversationId],
    queryFn: () => apiRequest<ThreadResponse>(`/api/messages/conversations/${conversationId}/messages?limit=80`),
    refetchInterval: 8_000,
  })

  useEffect(() => {
    apiRequest(`/api/messages/conversations/${conversationId}/read`, 'POST', {}).catch(() => {})
  }, [conversationId])

  const sendMutation = useMutation({
    mutationFn: async () => {
      const localAttachments = mediaDrafts.filter((m) => m.localUri)
      const readyAttachments = mediaDrafts.filter((m) => m.url)
      const trimmed = text.trim()
      if (!trimmed && localAttachments.length === 0 && readyAttachments.length === 0) return

      if (!isOnline) {
        await enqueueOutbox({
          id: `chat-${Date.now()}-${conversationId}`,
          type: 'message-send',
          payload: {
            conversationId,
            to: '',
            from: '',
            body: trimmed,
            channel: 'CHAT',
            media: readyAttachments.map((attachment) => ({
              type: attachment.kind.toLowerCase(),
              url: attachment.url as string,
              mimeType: attachment.mimeType,
              size: attachment.sizeBytes,
              filename: attachment.fileName,
            })),
          },
        })
        return
      }

      const uploaded: typeof readyAttachments = [...readyAttachments]
      for (const attachment of localAttachments) {
        if (!attachment.localUri || !token) continue
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
      }

      await apiRequest(`/api/messages/conversations/${conversationId}/messages`, 'POST', {
        text: trimmed,
        jobId: jobContext?.jobId || null,
        clientTempId: `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    onError: (error: any) => {
      Alert.alert('Error', error?.message || 'Message failed to send')
    },
  })

  const pickMedia = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) return
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

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync()
      if (!permission.granted) return
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      })
      const nextRecording = new Audio.Recording()
      await nextRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
      await nextRecording.startAsync()
      setRecording(nextRecording)
    } catch {
      Alert.alert('Recording error', 'Unable to start voice recording.')
    }
  }

  const stopRecording = async () => {
    if (!recording) return
    try {
      await recording.stopAndUnloadAsync()
      const uri = recording.getURI()
      const status = await recording.getStatusAsync()
      if (uri) {
        setMediaDrafts((prev) => [
          ...prev,
          {
            kind: 'VOICE',
            localUri: uri,
            mimeType: 'audio/m4a',
            fileName: `voice-${Date.now()}.m4a`,
            durationMs: status.isLoaded ? status.durationMillis || undefined : undefined,
          },
        ])
      }
    } finally {
      setRecording(null)
    }
  }

  const messages = useMemo(() => threadQuery.data?.messages || [], [threadQuery.data?.messages])

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{conversationQuery.data?.conversation?.title || 'Conversation'}</Text>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const mine = item.senderId === user?.id
          return (
            <View style={[styles.bubble, mine ? styles.outbound : styles.inbound]}>
              {!mine && (
                <Text style={styles.senderText}>{senderName(item)}</Text>
              )}
              {!!item.text && <Text style={[styles.messageText, mine && styles.outboundText]}>{item.text}</Text>}
              {item.jobId ? (
                <Pressable onPress={() => Linking.openURL(`trimpro://jobs/${item.jobId}`)} style={styles.jobStamp}>
                  <Text style={styles.jobStampText}>Job #{item.jobNumber} - {item.jobName}</Text>
                </Pressable>
              ) : null}
              {(item.attachments || []).map((attachment) => (
                <Pressable key={attachment.id} style={styles.attachmentRow} onPress={() => Linking.openURL(attachment.url)}>
                  <Text style={[styles.attachmentText, mine && styles.outboundText]}>
                    {attachment.kind === 'LOCATION'
                      ? 'Open location'
                      : attachment.kind === 'VOICE'
                        ? `Voice note ${attachment.durationMs ? `(${Math.round(attachment.durationMs / 1000)}s)` : ''}`
                        : attachment.fileName || `${attachment.kind} attachment`}
                  </Text>
                </Pressable>
              ))}
              <Text style={[styles.timeText, mine && styles.outboundTime]}>
                {new Date(item.createdAt).toLocaleTimeString()} {mine ? (item.status === 'READ' ? '✓✓' : item.status === 'DELIVERED' ? '✓✓' : '✓') : ''}
              </Text>
            </View>
          )
        }}
      />

      {mediaDrafts.length > 0 && (
        <View style={styles.draftRow}>
          {mediaDrafts.map((draft, index) => (
            <View key={`${draft.kind}-${index}`} style={styles.draftPill}>
              <Text style={styles.draftPillText}>
                {draft.kind}
                {draft.kind === 'LOCATION' && draft.latitude && draft.longitude ? ` (${draft.latitude.toFixed(3)}, ${draft.longitude.toFixed(3)})` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.composer}>
        <Pressable style={styles.actionButton} onPress={pickMedia} disabled={uploading}>
          <Text style={styles.actionText}>+</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={shareLocation}>
          <Text style={styles.smallActionText}>Loc</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, recording && styles.recordingButton]}
          onPressIn={startRecording}
          onPressOut={stopRecording}
        >
          <Text style={styles.smallActionText}>{recording ? 'Rec' : 'Mic'}</Text>
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type message..."
          style={styles.input}
          multiline
        />
        <Pressable style={[styles.sendButton, sendMutation.isPending && styles.disabledButton]} onPress={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
          <Text style={styles.sendText}>{sendMutation.isPending ? '...' : 'Send'}</Text>
        </Pressable>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 10 },
  header: {
    paddingBottom: 8,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#D0D5DD',
  },
  headerTitle: {
    color: BRAND.text,
    fontSize: 16,
    fontWeight: '700',
  },
  listContent: { paddingTop: 10, gap: 8, paddingBottom: 18 },
  bubble: {
    maxWidth: '86%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inbound: {
    alignSelf: 'flex-start',
    backgroundColor: '#EAECF0',
  },
  outbound: {
    alignSelf: 'flex-end',
    backgroundColor: BRAND.primary,
  },
  senderText: {
    color: '#475467',
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 4,
  },
  messageText: { color: BRAND.text, fontSize: 14 },
  outboundText: { color: BRAND.white },
  jobStamp: {
    marginTop: 6,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  jobStampText: {
    color: BRAND.white,
    fontSize: 12,
    fontWeight: '700',
  },
  attachmentRow: {
    marginTop: 6,
  },
  attachmentText: {
    fontSize: 12,
    textDecorationLine: 'underline',
    color: BRAND.text,
  },
  timeText: {
    marginTop: 4,
    fontSize: 11,
    color: '#667085',
    textAlign: 'right',
  },
  outboundTime: { color: '#D1E4EF' },
  draftRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  draftPill: {
    backgroundColor: '#EAECF0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  draftPillText: {
    color: BRAND.text,
    fontSize: 11,
    fontWeight: '600',
  },
  composer: {
    borderTopWidth: 1,
    borderColor: '#D0D5DD',
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND.white,
  },
  recordingButton: {
    backgroundColor: '#FEE2E2',
    borderColor: '#DC2626',
  },
  actionText: {
    fontSize: 18,
    color: BRAND.text,
    fontWeight: '700',
    lineHeight: 20,
  },
  smallActionText: {
    fontSize: 11,
    color: BRAND.text,
    fontWeight: '700',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    backgroundColor: BRAND.white,
    color: BRAND.text,
  },
  sendButton: {
    backgroundColor: BRAND.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  sendText: { color: BRAND.white, fontWeight: '700' },
  disabledButton: { opacity: 0.6 },
})
