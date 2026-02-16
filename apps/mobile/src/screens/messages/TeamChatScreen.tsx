import React, { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { Screen } from '../../components/Screen'
import { BRAND } from '../../config/env'
import { apiRequest } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useOnlineState } from '../../hooks/useOnlineState'
import { enqueueOutbox } from '../../offline/outbox'

interface TeamChatResponse {
  conversation: {
    id: string
    messages: Array<{
      id: string
      body: string | null
      createdAt: string
      metadata?: {
        senderName?: string
        senderUserId?: string
        mentions?: string[]
      } | null
      media?: Array<{
        id: string
        type: string
        filename?: string | null
      }>
    }>
  }
  teamMembers: Array<{
    id: string
    firstName: string
    lastName: string
    email: string
  }>
  unreadCount: number
}

export function TeamChatScreen() {
  const queryClient = useQueryClient()
  const { token, user } = useAuth()
  const isOnline = useOnlineState()
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

  const teamQuery = useQuery({
    queryKey: ['mobile-team-chat'],
    queryFn: () => apiRequest<TeamChatResponse>('/api/mobile/team-chat'),
    refetchInterval: 45_000,
  })

  const mentionSuggestions = useMemo(() => {
    const members = teamQuery.data?.teamMembers || []
    const match = text.match(/(?:^|\s)@([a-zA-Z0-9._-]*)$/)
    if (!match) return []
    const query = match[1].toLowerCase()
    if (!query) return members.slice(0, 6)
    return members
      .filter((m) => {
        const handle = `${m.firstName}.${m.lastName}`.toLowerCase().replace(/\s+/g, '')
        const full = `${m.firstName} ${m.lastName}`.toLowerCase()
        return handle.includes(query) || full.includes(query) || m.email.toLowerCase().includes(query)
      })
      .slice(0, 6)
  }, [teamQuery.data?.teamMembers, text])

  const extractMentionIds = useMemo(() => {
    const members = teamQuery.data?.teamMembers || []
    const handleToId = new Map(
      members.map((m) => [`${m.firstName}.${m.lastName}`.toLowerCase().replace(/\s+/g, ''), m.id] as const)
    )
    return (input: string) => {
      const tokens = Array.from(input.matchAll(/@([a-zA-Z0-9._-]+)/g)).map((m) => m[1].toLowerCase())
      const ids = tokens.map((token) => handleToId.get(token)).filter((id): id is string => Boolean(id))
      return Array.from(new Set(ids))
    }
  }, [teamQuery.data?.teamMembers])

  const insertMention = (member: { firstName: string; lastName: string }) => {
    const handle = `@${`${member.firstName}.${member.lastName}`.toLowerCase().replace(/\s+/g, '')}`
    setText((prev) => prev.replace(/(?:^|\s)@[a-zA-Z0-9._-]*$/, ` ${handle} `))
  }

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!text.trim() && mediaDrafts.length === 0) return
      const localMedia = mediaDrafts.filter((m) => m.localUri)
      const remoteMedia = mediaDrafts.filter((m) => m.url)
      const mentions = extractMentionIds(text)

      if (!isOnline) {
        if (localMedia.length > 0) {
          await enqueueOutbox({
            id: `${Date.now()}-team-chat-upload`,
            type: 'team-chat-send-with-upload',
            payload: {
              body: text.trim(),
              mentions,
              mediaFiles: localMedia.map((m) => ({
                type: m.type,
                uri: m.localUri as string,
                mimeType: m.mimeType || 'application/octet-stream',
                fileName: m.filename || `team-chat-${Date.now()}`,
                fileSize: m.size || 0,
              })),
            },
          })
        }
        if (remoteMedia.length > 0 || text.trim()) {
          await enqueueOutbox({
            id: `${Date.now()}-team-chat-send`,
            type: 'team-chat-send',
            payload: {
              body: text.trim(),
              mentions,
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
          throw new Error('Failed to upload local team chat media')
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

      await apiRequest('/api/mobile/team-chat', 'POST', {
        body: text.trim(),
        mentions,
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
      queryClient.invalidateQueries({ queryKey: ['mobile-team-chat'] })
    },
  })

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
    const filename = asset.fileName || `team-chat-${Date.now()}`

    if (!isOnline) {
      const mediaType = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'image' : 'file'
      setMediaDrafts((prev) => [
        ...prev,
        { type: mediaType, localUri: asset.uri, mimeType, size: asset.fileSize || undefined, filename },
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
      if (uploadResult.status < 200 || uploadResult.status >= 300) throw new Error('Upload failed')
      const payload = JSON.parse(uploadResult.body)
      const mediaType = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'image' : 'file'
      setMediaDrafts((prev) => [
        ...prev,
        { type: mediaType, url: payload.url, mimeType, size: asset.fileSize || undefined, filename },
      ])
    } finally {
      setUploading(false)
    }
  }

  const messages = useMemo(() => teamQuery.data?.conversation?.messages ?? [], [teamQuery.data?.conversation?.messages])

  return (
    <Screen style={styles.screen}>
      {mentionSuggestions.length > 0 && (
        <View style={styles.mentionBox}>
          {mentionSuggestions.map((member) => (
            <Pressable
              key={member.id}
              style={styles.mentionItem}
              onPress={() => insertMention(member)}
            >
              <Text style={styles.mentionItemText}>
                @{`${member.firstName}.${member.lastName}`.toLowerCase().replace(/\s+/g, '')}
              </Text>
              <Text style={styles.mentionItemSub}>
                {member.firstName} {member.lastName}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <FlatList
        data={messages}
        inverted
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.metadata?.senderUserId === user?.id ? styles.ownBubble : undefined]}>
            <View style={styles.senderRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(item.metadata?.senderName || 'T').charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.sender}>{item.metadata?.senderName || 'Team'}</Text>
            </View>
            {!!item.body && <Text style={styles.messageText}>{item.body}</Text>}
            {(item.media || []).length > 0 && (
              <Text style={styles.mediaText}>{(item.media || []).length} attachment(s)</Text>
            )}
            <Text style={styles.timeText}>{new Date(item.createdAt).toLocaleTimeString()}</Text>
          </View>
        )}
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
          placeholder="Message team..."
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
    maxWidth: '90%',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: BRAND.white,
    alignSelf: 'flex-start',
  },
  ownBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#EEF4F7',
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#D0D5DD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: BRAND.text,
    fontSize: 11,
    fontWeight: '700',
  },
  sender: { color: BRAND.primary, fontSize: 12, fontWeight: '700' },
  messageText: { color: BRAND.text, fontSize: 14, marginTop: 4 },
  mediaText: { color: BRAND.muted, fontSize: 12, marginTop: 4 },
  timeText: { marginTop: 4, fontSize: 11, color: '#667085' },
  composer: {
    borderTopWidth: 1,
    borderColor: '#D0D5DD',
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  mediaPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  mentionBox: {
    backgroundColor: BRAND.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EAECF0',
    marginBottom: 8,
  },
  mentionItem: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F4F7',
  },
  mentionItemText: {
    color: BRAND.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  mentionItemSub: {
    color: BRAND.muted,
    fontSize: 12,
    marginTop: 2,
  },
  mediaPill: {
    backgroundColor: '#EAECF0',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    maxWidth: '92%',
  },
  mediaPillText: { color: BRAND.text, fontSize: 12 },
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
  attachText: { fontSize: 18, color: BRAND.text, fontWeight: '700', lineHeight: 20 },
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
  sendText: { color: BRAND.white, fontWeight: '700' },
})

