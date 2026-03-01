import React from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Linking, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useQuery } from '@tanstack/react-query'
import { ResizeMode, Video } from 'expo-av'
import { Ionicons } from '@expo/vector-icons'
import { AppScreen } from '../../components/AppScreen'
import { EmptyState } from '../../components/EmptyState'
import { apiRequest } from '../../api/client'
import { JobsStackParamList } from '../../types/navigation'
import { colors, spacing, typography } from '../../theme/tokens'
import { getRequestDetailsErrorCopy } from './request-utils'
import { AttachmentPickerSheet } from '../../components/attachments/AttachmentPickerSheet'
import { AttachmentUploadQueue } from '../../components/attachments/AttachmentUploadQueue'
import { pickAttachmentsByAction, uploadFileWithProgress } from '../../services/attachment-upload'
import { useAttachmentUploadQueue } from '../../hooks/useAttachmentUploadQueue'

type Props = NativeStackScreenProps<JobsStackParamList, 'RequestDetail'>

interface RequestDetailResponse {
  lead: {
    id: string
    firstName: string
    lastName: string
    phone?: string | null
    email?: string | null
    company?: string | null
    jobSiteAddress?: string | null
    notes?: string | null
    status: string
    source: string
    createdAt: string
    assignedTo?: {
      firstName?: string | null
      lastName?: string | null
    } | null
  }
}

interface AttachmentResponse {
  attachments: Array<{
    id: string
    fileName: string
    url: string
    mimeType: string
    fileSize: number
    createdAt: string
  }>
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value || String(value).trim().length === 0) return null
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

export function RequestDetailScreen({ route }: Props) {
  const { requestId } = route.params
  const [showAttachmentPicker, setShowAttachmentPicker] = React.useState(false)
  const [localAttachments, setLocalAttachments] = React.useState<AttachmentResponse['attachments']>([])
  const [showImageViewer, setShowImageViewer] = React.useState(false)
  const [showVideoViewer, setShowVideoViewer] = React.useState(false)
  const [activeImageUrl, setActiveImageUrl] = React.useState<string | null>(null)
  const [activeVideoUrl, setActiveVideoUrl] = React.useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: ['mobile-request-detail', requestId],
    queryFn: () => apiRequest<RequestDetailResponse>(`/api/leads/${requestId}`),
  })

  const attachmentsQuery = useQuery({
    queryKey: ['mobile-request-attachments', requestId],
    queryFn: () =>
      apiRequest<AttachmentResponse>(
        `/api/attachments?entityType=request&entityId=${encodeURIComponent(requestId)}`
      ),
  })
  const requestUploadQueue = useAttachmentUploadQueue<{ attachment: AttachmentResponse['attachments'][number] }>({
    startUpload: (file, onProgress) => {
      const task = uploadFileWithProgress<{ attachment: AttachmentResponse['attachments'][number] }>(
        `/api/requests/${requestId}/attachments`,
        file,
        onProgress
      )
      return {
        promise: task.promise.then((result) => result.raw),
        cancel: task.cancel,
      }
    },
    onUploaded: (result) => {
      if (!result.attachment) return
      setLocalAttachments((prev) => [result.attachment, ...prev.filter((item) => item.id !== result.attachment.id)])
      void attachmentsQuery.refetch()
    },
  })

  if (detailQuery.isLoading) {
    return (
      <AppScreen>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.brandPrimary} />
          <Text style={styles.loadingText}>Loading request...</Text>
        </View>
      </AppScreen>
    )
  }

  if (detailQuery.isError || !detailQuery.data?.lead) {
    const errorCopy = getRequestDetailsErrorCopy((detailQuery.error as Error | undefined)?.message)
    return (
      <AppScreen>
        <View style={styles.loadingWrap}>
          <EmptyState
            icon="document-text-outline"
            title={errorCopy.title}
            description={errorCopy.description}
          />
          {errorCopy.canRetry ? (
            <Pressable style={styles.retryButton} onPress={() => void detailQuery.refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      </AppScreen>
    )
  }

  const lead = detailQuery.data.lead
  const attachments = [...localAttachments, ...(attachmentsQuery.data?.attachments || [])].filter(
    (item, index, arr) => arr.findIndex((inner) => inner.id === item.id) === index
  )

  const onSelectAttachmentAction = async (
    action: 'take-photo' | 'record-video' | 'choose-photos' | 'choose-videos' | 'choose-document'
  ) => {
    try {
      const picked = await pickAttachmentsByAction(action)
      if (!picked.length) return
      requestUploadQueue.enqueueFiles(picked)
    } catch (error: any) {
      Alert.alert('Attachment selection failed', error?.message || 'Please try again.')
    }
  }

  return (
    <AppScreen>
      <FlatList
        data={attachments}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={detailQuery.isRefetching || attachmentsQuery.isRefetching}
            onRefresh={() => {
              void detailQuery.refetch()
              void attachmentsQuery.refetch()
            }}
          />
        }
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerCard}>
            <Text style={styles.name}>
              {lead.firstName} {lead.lastName}
            </Text>
            <Text style={styles.meta}>
              Status: {lead.status} • Source: {lead.source}
            </Text>
            <Text style={styles.meta}>Request ID: {lead.id}</Text>
            <Text style={styles.meta}>Created: {new Date(lead.createdAt).toLocaleString()}</Text>
            {lead.assignedTo ? (
              <Text style={styles.meta}>
                Assigned to: {`${lead.assignedTo.firstName || ''} ${lead.assignedTo.lastName || ''}`.trim() || 'Unassigned'}
              </Text>
            ) : (
              <Text style={styles.meta}>Assigned to: Unassigned</Text>
            )}
            <DetailRow label="Phone" value={lead.phone} />
            <DetailRow label="Email" value={lead.email} />
            <DetailRow label="Address" value={lead.jobSiteAddress} />
            <DetailRow label="Description" value={lead.notes} />
            <Pressable style={styles.addButton} onPress={() => setShowAttachmentPicker(true)}>
              <Text style={styles.addButtonText}>Add Attachment</Text>
            </Pressable>
            <AttachmentUploadQueue
              items={requestUploadQueue.items}
              onRetry={(item) => requestUploadQueue.retryItem(item.id)}
              onRemove={(item) => requestUploadQueue.removeItem(item.id)}
              onCancel={(item) => requestUploadQueue.cancelItem(item.id)}
            />
            <Text style={styles.sectionTitle}>Attachments ({attachments.length})</Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyAttachments}>No attachments.</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.attachmentCard}
            onPress={() => {
              const mime = String(item.mimeType || '').toLowerCase()
              if (mime.startsWith('image/')) {
                setActiveImageUrl(item.url)
                setShowImageViewer(true)
                return
              }
              if (mime.startsWith('video/')) {
                setActiveVideoUrl(item.url)
                setShowVideoViewer(true)
                return
              }
              void Linking.openURL(item.url)
            }}
          >
            <View style={styles.attachmentTop}>
              <Ionicons
                name={
                  String(item.mimeType || '').startsWith('image/')
                    ? 'image-outline'
                    : String(item.mimeType || '').startsWith('video/')
                      ? 'videocam-outline'
                      : 'document-text-outline'
                }
                size={18}
                color={colors.textSecondary}
              />
              <Text style={styles.attachmentName} numberOfLines={1}>
                {item.fileName}
              </Text>
            </View>
            <Text style={styles.attachmentMeta}>
              {(item.fileSize / 1024).toFixed(1)} KB • {item.mimeType}
            </Text>
          </Pressable>
        )}
      />
      <Modal visible={showImageViewer} transparent={false} animationType="fade" onRequestClose={() => setShowImageViewer(false)}>
        <View style={styles.viewerRoot}>
          <Pressable style={styles.viewerClose} onPress={() => setShowImageViewer(false)}>
            <Text style={styles.viewerCloseText}>Close</Text>
          </Pressable>
          {activeImageUrl ? <Image source={{ uri: activeImageUrl }} style={styles.viewerImage} resizeMode="contain" /> : null}
        </View>
      </Modal>
      <Modal visible={showVideoViewer} transparent={false} animationType="fade" onRequestClose={() => setShowVideoViewer(false)}>
        <View style={styles.viewerRoot}>
          <Pressable style={styles.viewerClose} onPress={() => setShowVideoViewer(false)}>
            <Text style={styles.viewerCloseText}>Close</Text>
          </Pressable>
          {activeVideoUrl ? (
            <Video
              source={{ uri: activeVideoUrl }}
              style={styles.viewerVideo}
              useNativeControls
              shouldPlay
              resizeMode={ResizeMode.CONTAIN}
            />
          ) : null}
        </View>
      </Modal>
      <AttachmentPickerSheet
        visible={showAttachmentPicker}
        onClose={() => setShowAttachmentPicker(false)}
        onSelect={onSelectAttachmentAction}
      />
    </AppScreen>
  )
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  loadingText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  retryButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.brandPrimary,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryText: {
    ...typography.sub,
    color: colors.surface,
    fontWeight: '600',
  },
  addButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  addButtonText: {
    ...typography.sub,
    color: colors.brandPrimary,
    fontWeight: '600',
  },
  content: {
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.md,
    gap: 4,
  },
  name: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  row: {
    marginTop: spacing.xs,
  },
  rowLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  rowValue: {
    ...typography.sub,
    color: colors.textPrimary,
  },
  sectionTitle: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  emptyAttachments: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  attachmentCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.sm,
  },
  attachmentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  attachmentName: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  attachmentMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerClose: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.md,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  viewerCloseText: {
    ...typography.sub,
    color: '#fff',
    fontWeight: '600',
  },
  viewerImage: {
    flex: 1,
    width: '100%',
  },
  viewerVideo: {
    flex: 1,
    width: '100%',
  },
})
