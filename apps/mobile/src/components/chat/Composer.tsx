import React, { useRef } from 'react'
import { ActivityIndicator, GestureResponderEvent, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, typography } from '../../theme/tokens'

interface AttachmentDraft {
  kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'LOCATION'
  url?: string
  fileName?: string
  localUri?: string
  latitude?: number
  longitude?: number
  uploadProgress?: number
}

interface ComposerProps {
  text: string
  onChangeText: (text: string) => void
  onSend: () => void
  onOpenMenu: () => void
  onVoiceStart: (event: GestureResponderEvent) => void
  onVoiceMove: (event: GestureResponderEvent) => void
  onVoiceStop: (event: GestureResponderEvent) => void
  onVoiceCancel: () => void
  attachments: AttachmentDraft[]
  onRemoveAttachment: (index: number) => void
  recording: boolean
  recordingDurationMs?: number
  recordingWillCancel?: boolean
  replyPreview?: {
    senderName: string
    textPreview: string
  } | null
  onClearReply?: () => void
  sending: boolean
  disabled?: boolean
  bottomInset?: number
}

export function Composer({
  text,
  onChangeText,
  onSend,
  onOpenMenu,
  onVoiceStart,
  onVoiceMove,
  onVoiceStop,
  onVoiceCancel,
  attachments,
  onRemoveAttachment,
  recording,
  recordingDurationMs,
  recordingWillCancel,
  replyPreview,
  onClearReply,
  sending,
  disabled,
  bottomInset = 0,
}: ComposerProps) {
  const inputRef = useRef<TextInput>(null)
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !sending && !disabled
  const showMic = text.trim().length === 0 && attachments.length === 0
  const triggerSend = () => {
    // Force immediate visual clear to avoid stale text rendering on Android.
    inputRef.current?.clear()
    onChangeText('')
    onSend()
  }

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(spacing.sm, bottomInset),
        },
      ]}
    >
      {replyPreview ? (
        <View style={styles.replyPreview}>
          <View style={styles.replyAccent} />
          <View style={styles.replyBody}>
            <Text style={styles.replySender} numberOfLines={1}>
              {replyPreview.senderName}
            </Text>
            <Text style={styles.replyText} numberOfLines={1}>
              {replyPreview.textPreview || 'Attachment'}
            </Text>
          </View>
          <Pressable onPress={onClearReply} style={styles.replyClose}>
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}

      {attachments.length > 0 && (
        <View style={styles.attachmentsRow}>
          {attachments.map((attachment, index) => (
            <View key={index} style={styles.attachmentPill}>
              <Text style={styles.attachmentPillText} numberOfLines={1}>
                {attachment.kind === 'LOCATION' && attachment.latitude && attachment.longitude
                  ? `📍 Location`
                  : attachment.kind === 'VOICE'
                    ? '🎤 Voice'
                    : attachment.fileName || attachment.kind}
              </Text>
              {attachment.uploadProgress !== undefined && attachment.uploadProgress < 100 && (
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${attachment.uploadProgress}%` }]} />
                </View>
              )}
              <Pressable onPress={() => onRemoveAttachment(index)} style={styles.removeAttachment}>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={styles.inputRow}>
        <Pressable
          style={[styles.actionButton, disabled && styles.disabledButton]}
          onPress={onOpenMenu}
          disabled={disabled}
        >
          <Ionicons name="add" size={22} color={colors.textSecondary} />
        </Pressable>

        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={onChangeText}
          onSubmitEditing={triggerSend}
          placeholder="Message"
          placeholderTextColor={colors.textSecondary}
          multiline
          blurOnSubmit={false}
          returnKeyType="send"
          maxLength={2000}
          editable={!disabled && !recording}
        />

        {showMic ? (
          <Pressable
            style={[styles.actionButton, styles.rightActionButton, recording && styles.recordingButton, disabled && styles.disabledButton]}
            onPressIn={onVoiceStart}
            onPressMove={recording ? onVoiceMove : undefined}
            onTouchMove={recording ? onVoiceMove : undefined}
            onPressOut={recording ? onVoiceStop : undefined}
            hitSlop={8}
            disabled={disabled}
          >
            <Ionicons name={recording ? 'mic' : 'mic-outline'} size={20} color={recording ? colors.surface : colors.brandPrimary} />
          </Pressable>
        ) : (
          <Pressable style={[styles.sendButton, !canSend && styles.sendButtonDisabled]} onPress={triggerSend} disabled={!canSend}>
            {sending ? <ActivityIndicator size="small" color={colors.surface} /> : <Ionicons name="send" size={18} color={colors.surface} />}
          </Pressable>
        )}
      </View>
      {recording ? (
        <View style={styles.recordingHintRow}>
          <View style={[styles.recordingDot, recordingWillCancel && styles.recordingDotCancel]} />
          <Text style={[styles.recordingTimer, recordingWillCancel && styles.recordingTimerCancel]}>
            {`${Math.max(0, Math.round((recordingDurationMs || 0) / 1000))}s`}
          </Text>
          <Text style={[styles.recordingSlideHint, recordingWillCancel && styles.recordingSlideHintCancel]}>
            {recordingWillCancel ? 'Release to cancel' : 'Slide left to cancel'}
          </Text>
          <Pressable onPress={onVoiceCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 8,
    marginBottom: spacing.xs,
  },
  replyAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    backgroundColor: colors.brandPrimary,
    marginRight: 8,
  },
  replyBody: {
    flex: 1,
  },
  replySender: {
    ...typography.caption,
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  replyText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
  replyClose: {
    padding: 4,
  },
  attachmentsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  attachmentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    maxWidth: '80%',
  },
  attachmentPillText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontSize: 11,
  },
  progressBar: {
    width: 40,
    height: 2,
    backgroundColor: colors.divider,
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.brandPrimary,
  },
  removeAttachment: {
    padding: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  actionButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightActionButton: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  recordingButton: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  disabledButton: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
    backgroundColor: colors.divider,
  },
  recordingHintRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  recordingDotCancel: {
    backgroundColor: colors.warning,
  },
  recordingTimer: {
    ...typography.caption,
    color: colors.brandPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  recordingTimerCancel: {
    color: colors.warning,
  },
  recordingSlideHint: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  recordingSlideHintCancel: {
    color: colors.warning,
  },
  cancelText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
  },
})
