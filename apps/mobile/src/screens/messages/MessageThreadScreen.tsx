import React, { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { BRAND } from '../../config/env'
import { MessagesStackParamList } from '../../types/navigation'
import { useAuth } from '../../auth/AuthContext'
import { useOnlineState } from '../../hooks/useOnlineState'
import { enqueueOutbox } from '../../offline/outbox'

type Props = NativeStackScreenProps<MessagesStackParamList, 'MessageThread'>

interface ConversationDetailResponse {
  conversation: {
    id: string
    channel: string
    participants: string[]
    messages: Array<{
      id: string
      body: string
      direction: string
      createdAt: string
    }>
  }
}

export function MessageThreadScreen({ route }: Props) {
  const { conversationId } = route.params
  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [mediaDrafts, setMediaDrafts] = useState<
    Array<{
      type: string
      filename?: string
      mimeType?: string
      size?: number
      url?: string
      localUri?: string
    }>
  >([])
  const queryClient = useQueryClient()
  const { token } = useAuth()
  const isOnline = useOnlineState()

  const threadQuery = useQuery({
    queryKey: ['mobile-conversation-thread', conversationId],
    queryFn: () => apiRequest<ConversationDetailResponse>(`/api/messages/conversations/${conversationId}`),
    refetchInterval: 45_000,
  })

  const sendMutation = useMutation({
    mutationFn: async () => {
      const conversation = threadQuery.data?.conversation
      if (!conversation) return
      const recipient = conversation.participants?.[0] || ''
      if (!text.trim() && mediaDrafts.length === 0) return
      const localMedia = mediaDrafts.filter((m) => m.localUri)
      const remoteMedia = mediaDrafts.filter((m) => m.url)
      if (!isOnline) {
        if (localMedia.length > 0) {
          await enqueueOutbox({
            id: `${Date.now()}-message-upload-${conversation.id}`,
            type: 'message-send-with-upload',
            payload: {
              conversationId: conversation.id,
              to: recipient,
              from: 'mobile-field-app',
              body: text.trim(),
              channel: conversation.channel,
              mediaFiles: localMedia.map((m) => ({
                type: m.type,
                uri: m.localUri as string,
                mimeType: m.mimeType || 'application/octet-stream',
                fileName: m.filename || `chat-${Date.now()}`,
                fileSize: m.size || 0,
              })),
            },
          })
        }
        if (remoteMedia.length > 0 || text.trim()) {
          await enqueueOutbox({
            id: `${Date.now()}-message-${conversation.id}`,
            type: 'message-send',
            payload: {
              conversationId: conversation.id,
              to: recipient,
              from: 'mobile-field-app',
              body: text.trim(),
              channel: conversation.channel,
              media: remoteMedia.map((m) => ({
                type: m.type,
                url: m.url as string,
                mimeType: m.mimeType,
                size: m.size,
                filename: m.filename,
              })),
            },
          })
        }
        return
      }

      const uploadedFromLocal: Array<{ type: string; url: string; mimeType?: string; size?: number; filename?: string }> = []
      for (const media of localMedia) {
        if (!media.localUri || !token) continue
        const uploadResult = await FileSystem.uploadAsync(
          `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '') || 'http://localhost:3000'}/api/uploads`,
          media.localUri,
          {
            fieldName: 'file',
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.MULTIPART,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            },
            mimeType: media.mimeType || 'application/octet-stream',
          }
        )
        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          throw new Error('Failed to upload queued media')
        }
        const payload = JSON.parse(uploadResult.body)
        uploadedFromLocal.push({
          type: media.type,
          url: payload.url,
          mimeType: media.mimeType,
          size: media.size,
          filename: media.filename,
        })
      }

      await apiRequest('/api/messages/send', 'POST', {
        conversationId: conversation.id,
        to: recipient,
        from: 'mobile-field-app',
        body: text.trim(),
        channel: conversation.channel,
        media: [
          ...remoteMedia.map((m) => ({
            type: m.type,
            url: m.url as string,
            mimeType: m.mimeType,
            size: m.size,
            filename: m.filename,
          })),
          ...uploadedFromLocal,
        ],
      })
    },
    onSuccess: () => {
      setText('')
      setMediaDrafts([])
      queryClient.invalidateQueries({ queryKey: ['mobile-conversation-thread', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['mobile-conversations'] })
    },
  })

  const messages = useMemo(() => threadQuery.data?.conversation?.messages ?? [], [threadQuery.data?.conversation?.messages])

  const uploadMediaDraft = async () => {
    if (!token && isOnline) return
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
    const filename = asset.fileName || `chat-${Date.now()}`

    if (!isOnline) {
      const mediaType = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'image' : 'file'
      setMediaDrafts((prev) => [
        ...prev,
        {
          type: mediaType,
          localUri: asset.uri,
          mimeType,
          size: asset.fileSize || undefined,
          filename,
        },
      ])
      return
    }

    setUploading(true)
    try {
      const uploadResult = await FileSystem.uploadAsync(
        `${process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '') || 'http://localhost:3000'}/api/uploads`,
        asset.uri,
        {
          fieldName: 'file',
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          mimeType,
        }
      )

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error('Upload failed')
      }
      const payload = JSON.parse(uploadResult.body)
      const mediaType = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'image' : 'file'
      setMediaDrafts((prev) => [
        ...prev,
        {
          type: mediaType,
          url: payload.url,
          mimeType,
          size: asset.fileSize || undefined,
          filename,
        },
      ])
    } finally {
      setUploading(false)
    }
  }

  return (
    <Screen style={styles.screen}>
      <FlatList
        data={messages}
        inverted
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const outbound = item.direction === 'OUTBOUND'
          return (
            <View style={[styles.bubble, outbound ? styles.outbound : styles.inbound]}>
              <Text style={[styles.messageText, outbound && styles.outboundText]}>{item.body || '(media)'}</Text>
              <Text style={[styles.timeText, outbound && styles.outboundTime]}>{new Date(item.createdAt).toLocaleTimeString()}</Text>
            </View>
          )
        }}
      />
      {mediaDrafts.length > 0 && (
        <View style={styles.mediaPills}>
          {mediaDrafts.map((m, idx) => (
            <View key={`${m.url || m.localUri || 'draft'}-${idx}`} style={styles.mediaPill}>
              <Text style={styles.mediaPillText} numberOfLines={1}>
                {m.filename || m.type}
                {m.localUri ? ' (queued)' : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.composer}>
        <Pressable style={styles.attachButton} onPress={uploadMediaDraft} disabled={uploading}>
          <Text style={styles.attachText}>{uploading ? '...' : '+'}</Text>
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type message..."
          style={styles.input}
          multiline
        />
        <Pressable style={styles.sendButton} onPress={() => sendMutation.mutate()}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 10 },
  listContent: { paddingTop: 12, gap: 8 },
  bubble: {
    maxWidth: '82%',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  inbound: {
    alignSelf: 'flex-start',
    backgroundColor: '#EAECF0',
  },
  outbound: {
    alignSelf: 'flex-end',
    backgroundColor: BRAND.primary,
  },
  messageText: {
    color: BRAND.text,
    fontSize: 14,
  },
  outboundText: {
    color: BRAND.white,
  },
  timeText: {
    marginTop: 4,
    fontSize: 11,
    color: '#667085',
  },
  outboundTime: {
    color: '#D1E4EF',
  },
  composer: {
    borderTopWidth: 1,
    borderColor: '#D0D5DD',
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  mediaPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  mediaPill: {
    backgroundColor: '#EAECF0',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    maxWidth: '92%',
  },
  mediaPillText: {
    color: BRAND.text,
    fontSize: 12,
  },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND.white,
  },
  attachText: {
    fontSize: 18,
    color: BRAND.text,
    fontWeight: '700',
    lineHeight: 20,
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
  },
  sendButton: {
    backgroundColor: BRAND.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  sendText: {
    color: BRAND.white,
    fontWeight: '700',
  },
})

