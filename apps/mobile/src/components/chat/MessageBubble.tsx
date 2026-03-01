import React, { useState } from 'react'
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Audio } from 'expo-av'
import { colors, spacing, typography } from '../../theme/tokens'
import { ChatMessage } from '../../types/models'
import { BRAND } from '../../config/env'

interface MessageBubbleProps {
  message: ChatMessage | { sender?: ChatMessage['sender'] | null; [key: string]: any }
  isMine: boolean
  showSender?: boolean
  onJobPress?: (jobId: string) => void
  onLongPress?: () => void
  onImagePress?: (uri: string, fileName?: string | null) => void
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

export function MessageBubble({ message, isMine, showSender, onJobPress, onLongPress, onImagePress }: MessageBubbleProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null)
  const [playing, setPlaying] = useState(false)

  const playVoiceNote = async (url: string) => {
    try {
      if (sound) {
        await sound.unloadAsync()
      }
      const { sound: newSound } = await Audio.Sound.createAsync({ uri: url })
      setSound(newSound)
      await newSound.playAsync()
      setPlaying(true)
      newSound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlaying(false)
        }
      })
    } catch (error) {
      console.error('Error playing voice note:', error)
    }
  }

  const stopVoiceNote = async () => {
    if (sound) {
      await sound.stopAsync()
      await sound.unloadAsync()
      setSound(null)
      setPlaying(false)
    }
  }

  React.useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync()
      }
    }
  }, [sound])

  return (
    <Pressable
      style={[styles.container, isMine ? styles.mineContainer : styles.otherContainer]}
      onLongPress={onLongPress}
    >
      <View style={[styles.bubble, isMine ? styles.mineBubble : styles.otherBubble]}>
        {showSender && !isMine && (
          <Text style={styles.senderName}>{senderName(message)}</Text>
        )}
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
        {message.attachments?.map((attachment, idx) => {
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
              <Pressable
                key={attachmentId}
                style={[styles.voiceContainer, isMine && styles.voiceContainerMine]}
                onPress={() => (playing ? stopVoiceNote() : playVoiceNote(attachment.url))}
              >
                <Ionicons
                  name={playing ? 'pause-circle' : 'play-circle'}
                  size={24}
                  color={isMine ? colors.surface : colors.brandPrimary}
                />
                <View style={styles.voiceInfo}>
                  <View style={styles.voiceWaveform} />
                  <Text style={[styles.voiceDuration, isMine && styles.voiceDurationMine]}>
                    {attachment.durationMs ? `${Math.round(attachment.durationMs / 1000)}s` : 'Voice note'}
                  </Text>
                </View>
              </Pressable>
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
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 2,
    paddingHorizontal: spacing.md,
  },
  mineContainer: {
    alignItems: 'flex-end',
  },
  otherContainer: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  mineBubble: {
    backgroundColor: colors.brandPrimary,
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: colors.divider,
    borderBottomLeftRadius: 4,
  },
  senderName: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 2,
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
  voiceContainer: {
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
  voiceContainerMine: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  voiceInfo: {
    flex: 1,
    gap: 2,
  },
  voiceWaveform: {
    height: 4,
    backgroundColor: colors.divider,
    borderRadius: 2,
  },
  voiceDuration: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  voiceDurationMine: {
    color: colors.surface,
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
    marginTop: 4,
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
