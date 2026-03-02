import React, { useMemo, useRef } from 'react'
import { Animated, Dimensions, Image, Linking, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, typography } from '../../theme/tokens'
import { ChatMessage } from '../../types/models'
import { VoiceNoteBubble } from './VoiceNoteBubble'
import { ReplyPreview } from './ReplyPreview'

interface MessageBubbleProps {
  message: ChatMessage | { sender?: ChatMessage['sender'] | null; [key: string]: any }
  isMine: boolean
  showSender?: boolean
  onJobPress?: (jobId: string) => void
  onLongPress?: () => void
  onImagePress?: (uri: string, fileName?: string | null) => void
  onSwipeReply?: (message: ChatMessage) => void
  onReplyPress?: (messageId: string) => void
}

function senderName(message: ChatMessage | { sender?: ChatMessage['sender'] | null }) {
  const sender = message.sender
  if (!sender) return 'Unknown'
  const value = `${sender.firstName || ''} ${sender.lastName || ''}`.trim()
  return value || sender.email
}

function formatMessageTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function statusIcon(status: string) {
  if (status === 'READ') return '✓✓'
  if (status === 'DELIVERED') return '✓✓'
  return '✓'
}

const SCREEN_WIDTH = Dimensions.get('window').width
const VOICE_BUBBLE_MAX_WIDTH = Math.round(SCREEN_WIDTH * 0.86)
const VOICE_BUBBLE_MIN_WIDTH = Math.round(Math.min(SCREEN_WIDTH * 0.7, 320))

export function MessageBubble({
  message,
  isMine,
  showSender,
  onJobPress,
  onLongPress,
  onImagePress,
  onSwipeReply,
  onReplyPress,
}: MessageBubbleProps) {
  const translateX = useRef(new Animated.Value(0)).current
  const hasTriggeredReply = useRef(false)
  const SWIPE_THRESHOLD = 60

  const bubblePanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dx > 0) {
            translateX.setValue(Math.min(gesture.dx, 84))
            if (!hasTriggeredReply.current && gesture.dx > SWIPE_THRESHOLD && onSwipeReply) {
              hasTriggeredReply.current = true
              onSwipeReply(message as ChatMessage)
            }
          }
        },
        onPanResponderRelease: () => {
          hasTriggeredReply.current = false
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            speed: 24,
            bounciness: 4,
          }).start()
        },
        onPanResponderTerminate: () => {
          hasTriggeredReply.current = false
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            speed: 24,
            bounciness: 4,
          }).start()
        },
      }),
    [isMine, message, onSwipeReply, translateX]
  )

  const hasOnlyVoiceAttachment =
    !message.text &&
    !!message.attachments?.length &&
    message.attachments.every((attachment: any) => attachment.kind === 'VOICE')

  return (
    <Animated.View style={[styles.container, isMine ? styles.mineContainer : styles.otherContainer, { transform: [{ translateX }] }]}>
      {!isMine && !hasOnlyVoiceAttachment ? (
        <View style={styles.sideAvatar}>
          {message.sender?.avatar ? (
            <Image source={{ uri: message.sender.avatar }} style={styles.sideAvatarImage} />
          ) : (
            <Text style={styles.sideAvatarInitial}>{senderName(message).slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
      ) : null}
      <View style={styles.bubbleGestureWrap} {...bubblePanResponder.panHandlers}>
      <Pressable
        style={[
          styles.bubble,
          isMine ? styles.mineBubble : styles.otherBubble,
          hasOnlyVoiceAttachment && styles.voiceOnlyBubble,
        ]}
        onLongPress={onLongPress}
      >
        {showSender && !isMine && (
          <View style={styles.senderRow}>
            {message.sender?.avatar ? <Image source={{ uri: message.sender.avatar }} style={styles.senderAvatar} /> : null}
            <Text style={styles.senderName}>{senderName(message)}</Text>
          </View>
        )}
        {message.replyTo ? (
          <ReplyPreview
            isOutgoing={isMine}
            senderName={message.replyTo.senderName}
            textPreview={message.replyTo.textPreview || 'Attachment'}
            onPress={() => {
              if (message.replyTo?.messageId && onReplyPress) onReplyPress(message.replyTo.messageId)
            }}
          />
        ) : null}
        {message.jobId && (
          <Pressable
            style={[styles.jobBadge, isMine && styles.jobBadgeMine]}
            onPress={() => (onJobPress ? onJobPress(message.jobId!) : Linking.openURL(`trimpro://jobs/${message.jobId}`))}
          >
            <Ionicons name="briefcase-outline" size={12} color={isMine ? colors.surface : colors.brandPrimary} />
            <Text style={[styles.jobBadgeText, isMine && styles.jobBadgeTextMine]}>
              {message.jobNumber || 'JOB'} • {message.jobName || 'View Job'}
            </Text>
          </Pressable>
        )}
        {message.text ? <Text style={[styles.text, isMine && styles.textMine]}>{message.text}</Text> : null}
        {message.attachments?.map((attachment: any, idx: number) => {
          const attachmentId = 'id' in attachment ? attachment.id : `att-${idx}`
          if (attachment.kind === 'IMAGE') {
            return (
              <Pressable
                key={attachmentId}
                style={styles.imageContainer}
                onPress={() => {
                  if (onImagePress) {
                    onImagePress(attachment.url, attachment.fileName || null)
                  } else {
                    Linking.openURL(attachment.url)
                  }
                }}
              >
                <Image source={{ uri: attachment.url }} style={styles.image} resizeMode="cover" />
              </Pressable>
            )
          }
          if (attachment.kind === 'VIDEO') {
            return (
              <Pressable
                key={attachmentId}
                style={styles.videoContainer}
                onPress={() => Linking.openURL(attachment.url)}
              >
                {attachment.thumbnailUrl ? (
                  <Image source={{ uri: attachment.thumbnailUrl }} style={styles.image} resizeMode="cover" />
                ) : null}
                <View style={styles.playOverlay}>
                  <Ionicons name="play-circle" size={40} color={colors.surface} />
                </View>
              </Pressable>
            )
          }
          if (attachment.kind === 'VOICE') {
            return (
              <VoiceNoteBubble
                key={attachmentId}
                messageId={String(message.id || attachmentId)}
                audioUrl={attachment.url}
                durationMs={attachment.durationMs || null}
                isOutgoing={isMine}
                timestamp={formatMessageTime(message.createdAt)}
                deliveryStatus={message.status}
                senderAvatarUrl={message.sender?.avatar || null}
                senderInitials={senderName(message).slice(0, 1).toUpperCase()}
              />
            )
          }
          if (attachment.kind === 'LOCATION') {
            return (
              <Pressable
                key={attachmentId}
                style={[styles.locationContainer, isMine && styles.locationContainerMine]}
                onPress={() => Linking.openURL(attachment.url)}
              >
                <Ionicons name="location" size={20} color={isMine ? colors.surface : colors.brandPrimary} />
                <Text style={[styles.locationText, isMine && styles.locationTextMine]}>Open in Maps</Text>
                {attachment.latitude && attachment.longitude && (
                  <Text style={[styles.locationCoords, isMine && styles.locationCoordsMine]}>
                    {attachment.latitude.toFixed(4)}, {attachment.longitude.toFixed(4)}
                  </Text>
                )}
              </Pressable>
            )
          }
          if (attachment.kind === 'FILE') {
            return (
              <Pressable
                key={attachmentId}
                style={[styles.fileContainer, isMine && styles.fileContainerMine]}
                onPress={() => Linking.openURL(attachment.url)}
              >
                <Ionicons name="document" size={20} color={isMine ? colors.surface : colors.brandPrimary} />
                <View style={styles.fileInfo}>
                  <Text style={[styles.fileName, isMine && styles.fileNameMine]} numberOfLines={1}>
                    {attachment.fileName || 'File'}
                  </Text>
                  {attachment.sizeBytes && (
                    <Text style={[styles.fileSize, isMine && styles.fileSizeMine]}>
                      {(attachment.sizeBytes / 1024).toFixed(1)} KB
                    </Text>
                  )}
                </View>
                <Ionicons name="download-outline" size={18} color={isMine ? colors.surface : colors.brandPrimary} />
              </Pressable>
            )
          }
          return null
        })}
        {!hasOnlyVoiceAttachment ? (
          <View style={styles.footer}>
            <Text style={[styles.time, isMine && styles.timeMine]}>
              {formatMessageTime(message.createdAt)}
            </Text>
            {isMine && (
              <Text style={[styles.status, isMine && styles.statusMine]}>
                {statusIcon(message.status)}
              </Text>
            )}
          </View>
        ) : null}
      </Pressable>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 1,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  mineContainer: {
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  otherContainer: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  sideAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#dbe7ef',
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideAvatarImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  sideAvatarInitial: {
    ...typography.caption,
    color: '#27485a',
    fontWeight: '700',
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  bubbleGestureWrap: {
    maxWidth: '86%',
  },
  voiceOnlyBubble: {
    maxWidth: VOICE_BUBBLE_MAX_WIDTH,
    minWidth: VOICE_BUBBLE_MIN_WIDTH,
    paddingRight: 16,
    paddingBottom: 8,
  },
  mineBubble: {
    backgroundColor: colors.brandPrimary,
    borderBottomRightRadius: 3,
  },
  otherBubble: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 3,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  senderName: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 2,
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  senderAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  jobBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(46, 74, 89, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 4,
  },
  jobBadgeMine: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  jobBadgeText: {
    ...typography.caption,
    color: colors.brandPrimary,
    fontWeight: '600',
    fontSize: 11,
  },
  jobBadgeTextMine: {
    color: colors.surface,
  },
  text: {
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 15,
  },
  textMine: {
    color: colors.surface,
  },
  imageContainer: {
    marginTop: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: 200,
    height: 200,
    maxWidth: '100%',
  },
  videoContainer: {
    marginTop: 4,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  locationContainerMine: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  locationText: {
    ...typography.sub,
    color: colors.brandPrimary,
    fontWeight: '600',
  },
  locationTextMine: {
    color: colors.surface,
  },
  locationCoords: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 10,
  },
  locationCoordsMine: {
    color: colors.surface + 'CC',
  },
  fileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  fileContainerMine: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  fileInfo: {
    flex: 1,
    gap: 2,
  },
  fileName: {
    ...typography.sub,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  fileNameMine: {
    color: colors.surface,
  },
  fileSize: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 10,
  },
  fileSizeMine: {
    color: colors.surface + 'CC',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 3,
  },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  timeMine: {
    color: colors.surface + 'CC',
  },
  status: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  statusMine: {
    color: colors.surface + 'CC',
  },
})
