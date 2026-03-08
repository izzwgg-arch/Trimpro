import React from 'react'
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native'
import { Composer } from '../../../components/chat/Composer'
import { ChatMessage } from '../../../types/models'
import { colors, spacing, typography } from '../../../theme/tokens'
import { AttachmentDraft } from '../types/message-thread-v2'

interface Props {
  editingMessage: ChatMessage | null
  onCancelEdit: () => void
  text: string
  onChangeText: (text: string) => void
  onSend: () => void
  onOpenMenu: () => void
  onVoiceStart: any
  onVoiceMove: any
  onVoiceStop: any
  onVoiceCancel: () => void
  attachments: AttachmentDraft[]
  onRemoveAttachment: (index: number) => void
  recording: boolean
  recordingDurationMs: number
  recordingWillCancel: boolean
  replyPreview: { senderName: string; textPreview: string } | null
  onClearReply: () => void
  sending: boolean
  disabled: boolean
  onLayoutHeight: (height: number) => void
}

export function MessageDockV2({
  editingMessage,
  onCancelEdit,
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
  onLayoutHeight,
}: Props) {
  const handleLayout = (event: LayoutChangeEvent) => {
    onLayoutHeight(Math.round(event.nativeEvent.layout.height))
  }

  return (
    <View style={styles.dockWrap} onLayout={handleLayout}>
      {editingMessage ? (
        <View style={styles.editingBar}>
          <View style={styles.editingBarTextWrap}>
            <Text style={styles.editingLabel}>Editing message</Text>
            <Text numberOfLines={1} style={styles.editingPreview}>
              {editingMessage.text || ''}
            </Text>
          </View>
          <Pressable style={styles.editingCancelButton} onPress={onCancelEdit}>
            <Text style={styles.editingCancelText}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.composerDock}>
        <Composer
          text={text}
          onChangeText={onChangeText}
          onSend={onSend}
          onOpenMenu={onOpenMenu}
          onVoiceStart={onVoiceStart}
          onVoiceMove={onVoiceMove}
          onVoiceStop={onVoiceStop}
          onVoiceCancel={onVoiceCancel}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          recording={recording}
          recordingDurationMs={recordingDurationMs}
          recordingWillCancel={recordingWillCancel}
          replyPreview={replyPreview}
          onClearReply={onClearReply}
          sending={sending}
          disabled={disabled}
          bottomInset={0}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  dockWrap: {
    backgroundColor: colors.surface,
  },
  composerDock: {
    backgroundColor: colors.surface,
  },
  editingBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  editingBarTextWrap: {
    flex: 1,
  },
  editingLabel: {
    ...typography.caption,
    color: colors.brandPrimary,
    fontWeight: '700',
  },
  editingPreview: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  editingCancelButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#EEF2F7',
  },
  editingCancelText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '600',
  },
})
