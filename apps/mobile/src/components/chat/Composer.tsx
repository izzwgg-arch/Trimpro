import React from 'react'
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
  onAttach: () => void
  onLocation: () => void
  onVoiceStart: (event: GestureResponderEvent) => void
  onVoiceMove: (event: GestureResponderEvent) => void
  onVoiceStop: (event: GestureResponderEvent) => void
  onVoiceCancel: () => void
  attachments: AttachmentDraft[]
  onRemoveAttachment: (index: number) => void
  recording: boolean
  recordingDurationMs?: number
  recordingWillCancel?: boolean
  sending: boolean
  disabled?: boolean
  bottomInset?: number
}

export function Composer({
  text,
  onChangeText,
  onSend,
  onAttach,
  onLocation,
  onVoiceStart,
  onVoiceMove,
  onVoiceStop,
  onVoiceCancel,
  attachments,
  onRemoveAttachment,
  recording,
  recordingDurationMs,
  recordingWillCancel,
  sending,
  disabled,
  bottomInset = 0,
}: ComposerProps) {
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !sending && !disabled

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(spacing.sm, bottomInset),
        },
      ]}
    >
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
          onPress={onAttach}
          disabled={disabled}
        >
          <Ionicons name="add" size={22} color={colors.brandPrimary} />
        </Pressable>

        <Pressable
          style={[styles.actionButton, disabled && styles.disabledButton]}
          onPress={onLocation}
          disabled={disabled}
        >
          <Ionicons name="location-outline" size={20} color={colors.brandPrimary} />
        </Pressable>

        <Pressable
          style={[styles.actionButton, recording && styles.recordingButton, disabled && styles.disabledButton]}
          onPressIn={onVoiceStart}
          onPressMove={onVoiceMove}
          onPressOut={onVoiceStop}
          delayLongPress={250}
          hitSlop={8}
          disabled={disabled}
        >
          <Ionicons
            name={recording ? 'mic' : 'mic-outline'}
            size={20}
            color={recording ? colors.surface : colors.brandPrimary}
          />
        </Pressable>

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={onChangeText}
          placeholder="Type a message..."
          placeholderTextColor={colors.textSecondary}
          multiline
          maxLength={2000}
          editable={!disabled}
        />

        <Pressable
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          onPress={onSend}
          disabled={!canSend}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.surface} />
          ) : (
            <Ionicons name="send" size={20} color={colors.surface} />
          )}
        </Pressable>
      </View>
      {recording ? (
        <View style={styles.recordingHintRow}>
          <Text style={[styles.recordingHint, recordingWillCancel && styles.recordingHintCancel]}>
            {recordingWillCancel
              ? 'Release to cancel'
              : `Recording... ${Math.max(0, Math.round((recordingDurationMs || 0) / 1000))}s`}
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 36,
    maxHeight: 100,
    borderRadius: 18,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recordingHint: {
    ...typography.caption,
    color: colors.brandPrimary,
    fontSize: 12,
  },
  recordingHintCancel: {
    color: colors.danger,
  },
  cancelText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
  },
})
