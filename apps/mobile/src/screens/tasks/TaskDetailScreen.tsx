import React, { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { Screen } from '../../components/Screen'
import { apiRequest } from '../../api/client'
import { StatusChip } from '../../components/StatusChip'
import { API_BASE_URL, BRAND } from '../../config/env'
import { TasksStackParamList } from '../../types/navigation'
import { useAuth } from '../../auth/AuthContext'
import { useOnlineState } from '../../hooks/useOnlineState'
import { enqueueOutbox } from '../../offline/outbox'

type Props = NativeStackScreenProps<TasksStackParamList, 'TaskDetail'>

interface TaskDetailResponse {
  task: any
}

interface AttachmentResponse {
  attachments: Array<{
    id: string
    fileName: string
    fileSize: number
  }>
}

export function TaskDetailScreen({ route }: Props) {
  const { taskId } = route.params
  const queryClient = useQueryClient()
  const [noteText, setNoteText] = useState('')
  const { token } = useAuth()
  const isOnline = useOnlineState()

  const taskQuery = useQuery({
    queryKey: ['mobile-task-detail', taskId],
    queryFn: () => apiRequest<TaskDetailResponse>(`/api/tasks/${taskId}`),
    refetchInterval: 45_000,
  })

  const attachmentsQuery = useQuery({
    queryKey: ['mobile-task-attachments', taskId],
    queryFn: () => apiRequest<AttachmentResponse>(`/api/attachments?entityType=task&entityId=${taskId}`),
    refetchInterval: 45_000,
  })

  const updateMutation = useMutation({
    mutationFn: async (payload: { status?: string; description?: string }) => {
      if (!isOnline && payload.status) {
        await enqueueOutbox({
          id: `${Date.now()}-task-status-${taskId}`,
          type: 'task-status',
          payload: {
            taskId,
            status: payload.status,
          },
        })
        return
      }
      await apiRequest(`/api/tasks/${taskId}`, 'PUT', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mobile-task-detail', taskId] })
      queryClient.invalidateQueries({ queryKey: ['mobile-tasks'] })
    },
  })

  const task = taskQuery.data?.task

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
    const fileName = asset.fileName || `task-${taskId}-${Date.now()}`
    if (!isOnline) {
      await enqueueOutbox({
        id: `${Date.now()}-task-media-${taskId}`,
        type: 'entity-media',
        payload: {
          entityType: 'task',
          entityId: taskId,
          uri: asset.uri,
          mimeType,
          fileName,
          fileSize: asset.fileSize || 0,
        },
      })
      queryClient.invalidateQueries({ queryKey: ['mobile-task-attachments', taskId] })
      return
    }
    const upload = await FileSystem.uploadAsync(
      `${API_BASE_URL}/api/uploads`,
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
      entityType: 'task',
      entityId: taskId,
      fileName,
      url: payload.url,
      key: payload.filename || payload.url,
      mimeType,
      fileSize: asset.fileSize || 0,
    })
    queryClient.invalidateQueries({ queryKey: ['mobile-task-attachments', taskId] })
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {!task ? (
          <Text style={styles.empty}>Loading task...</Text>
        ) : (
          <>
            <Text style={styles.title}>{task.title}</Text>
            <StatusChip status={task.status} />
            <Text style={styles.meta}>Priority: {task.priority}</Text>
            <Text style={styles.meta}>Due: {task.dueDate ? new Date(task.dueDate).toLocaleString() : 'Not set'}</Text>
            <Text style={styles.meta}>Assignee: {task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : 'N/A'}</Text>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.body}>{task.description || 'No description'}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Actions</Text>
              <View style={styles.row}>
                <Pressable style={styles.secondaryButton} onPress={() => updateMutation.mutate({ status: 'IN_PROGRESS' })}>
                  <Text style={styles.secondaryButtonText}>Start</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={() => updateMutation.mutate({ status: 'COMPLETED' })}>
                  <Text style={styles.primaryButtonText}>Complete</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Internal note</Text>
              <TextInput
                value={noteText}
                onChangeText={setNoteText}
                multiline
                style={styles.input}
                placeholder="Add a note to task description..."
              />
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  const nextDescription = [task.description || '', noteText.trim()].filter(Boolean).join('\n\n')
                  updateMutation.mutate({ description: nextDescription })
                  setNoteText('')
                }}
              >
                <Text style={styles.secondaryButtonText}>Append Note</Text>
              </Pressable>
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
  row: { flexDirection: 'row', gap: 8 },
  input: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    padding: 10,
    textAlignVertical: 'top',
  },
  primaryButton: { backgroundColor: BRAND.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  primaryButtonText: { color: BRAND.white, fontWeight: '700' },
  secondaryButton: {
    borderColor: '#D0D5DD',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
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

