import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { StatusChip } from '../../components/StatusChip'
import { BRAND } from '../../config/env'
import { MoreStackParamList } from '../../types/navigation'
import { useAuth } from '../../auth/AuthContext'
import { useOnlineState } from '../../hooks/useOnlineState'
import { enqueueOutbox } from '../../offline/outbox'

type Props = NativeStackScreenProps<MoreStackParamList, 'IssueDetail'>

interface IssueDetailResponse {
  issue: any
}

interface AttachmentResponse {
  attachments: Array<{
    id: string
    fileName: string
    fileSize: number
  }>
}

export function IssueDetailScreen({ route }: Props) {
  const { issueId } = route.params
  const queryClient = useQueryClient()
  const { token } = useAuth()
  const isOnline = useOnlineState()
  const issueQuery = useQuery({
    queryKey: ['mobile-issue-detail', issueId],
    queryFn: () => apiRequest<IssueDetailResponse>(`/api/issues/${issueId}`),
    refetchInterval: 45_000,
  })

  const attachmentsQuery = useQuery({
    queryKey: ['mobile-issue-attachments', issueId],
    queryFn: () => apiRequest<AttachmentResponse>(`/api/attachments?entityType=issue&entityId=${issueId}`),
    refetchInterval: 45_000,
  })

  const updateMutation = useMutation({
    mutationFn: async (status: string) => {
      if (!isOnline) {
        await enqueueOutbox({
          id: `${Date.now()}-issue-status-${issueId}`,
          type: 'issue-status',
          payload: { issueId, status },
        })
        return
      }
      await apiRequest(`/api/issues/${issueId}`, 'PUT', { status })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mobile-issue-detail', issueId] })
      queryClient.invalidateQueries({ queryKey: ['mobile-issues'] })
    },
  })

  const issue = issueQuery.data?.issue

  const uploadAttachment = async () => {
    if (!token) return
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) return

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.72,
    })
    if (result.canceled || result.assets.length === 0) return
    const asset = result.assets[0]
    const mimeType = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg')
    const fileName = asset.fileName || `issue-${issueId}-${Date.now()}`
    if (!isOnline) {
      await enqueueOutbox({
        id: `${Date.now()}-issue-media-${issueId}`,
        type: 'entity-media',
        payload: {
          entityType: 'issue',
          entityId: issueId,
          uri: asset.uri,
          mimeType,
          fileName,
          fileSize: asset.fileSize || 0,
        },
      })
      queryClient.invalidateQueries({ queryKey: ['mobile-issue-attachments', issueId] })
      return
    }
    const upload = await FileSystem.uploadAsync(
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
    if (upload.status < 200 || upload.status >= 300) return
    const payload = JSON.parse(upload.body)
    await apiRequest('/api/attachments', 'POST', {
      entityType: 'issue',
      entityId: issueId,
      fileName,
      url: payload.url,
      key: payload.filename || payload.url,
      mimeType,
      fileSize: asset.fileSize || 0,
    })
    queryClient.invalidateQueries({ queryKey: ['mobile-issue-attachments', issueId] })
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {!issue ? (
          <Text style={styles.empty}>Loading issue...</Text>
        ) : (
          <>
            <Text style={styles.title}>{issue.title}</Text>
            <StatusChip status={issue.status} />
            <Text style={styles.meta}>Type: {issue.type}</Text>
            <Text style={styles.meta}>Priority: {issue.priority}</Text>
            <Text style={styles.meta}>
              Job: {issue.job ? `${issue.job.jobNumber} - ${issue.job.title}` : 'No linked job'}
            </Text>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.body}>{issue.description || 'No description'}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Actions</Text>
              <View style={styles.row}>
                <Pressable style={styles.secondaryButton} onPress={() => updateMutation.mutate('IN_PROGRESS')}>
                  <Text style={styles.secondaryButtonText}>Start</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => updateMutation.mutate('ESCALATED')}>
                  <Text style={styles.secondaryButtonText}>Escalate</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={() => updateMutation.mutate('RESOLVED')}>
                  <Text style={styles.primaryButtonText}>Resolve</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Attachments</Text>
              <Pressable style={styles.secondaryButton} onPress={uploadAttachment}>
                <Text style={styles.secondaryButtonText}>Attach Photo/Video</Text>
              </Pressable>
              {(attachmentsQuery.data?.attachments || []).map((a) => (
                <View key={a.id} style={styles.attachmentRow}>
                  <Text style={styles.attachmentName}>{a.fileName}</Text>
                  <Text style={styles.attachmentMeta}>{Math.round(a.fileSize / 1024)} KB</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 10 },
  empty: { textAlign: 'center', marginTop: 30, color: BRAND.muted },
  title: { fontSize: 22, fontWeight: '800', color: BRAND.text },
  meta: { fontSize: 13, color: BRAND.muted },
  section: { backgroundColor: BRAND.white, borderRadius: 12, padding: 12, gap: 8 },
  sectionTitle: { color: BRAND.text, fontWeight: '700', fontSize: 15 },
  body: { color: BRAND.text, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  primaryButton: { backgroundColor: BRAND.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  primaryButtonText: { color: BRAND.white, fontWeight: '700' },
  secondaryButton: {
    borderColor: '#D0D5DD',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { color: BRAND.text, fontWeight: '600' },
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

