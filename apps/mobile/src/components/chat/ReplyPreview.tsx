import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, typography } from '../../theme/tokens'

interface ReplyPreviewProps {
  senderName: string
  textPreview: string
  isOutgoing: boolean
  onPress?: () => void
}

export function ReplyPreview({ senderName, textPreview, isOutgoing, onPress }: ReplyPreviewProps) {
  return (
    <Pressable onPress={onPress} style={[styles.container, isOutgoing && styles.containerOutgoing]}>
      <View style={[styles.accent, isOutgoing && styles.accentOutgoing]} />
      <View style={styles.body}>
        <Text style={[styles.sender, isOutgoing && styles.senderOutgoing]} numberOfLines={1}>
          {senderName}
        </Text>
        <Text style={[styles.preview, isOutgoing && styles.previewOutgoing]} numberOfLines={1}>
          {textPreview || 'Attachment'}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 8,
    backgroundColor: 'rgba(38,95,178,0.10)',
    paddingVertical: 6,
    paddingHorizontal: 7,
    marginBottom: 6,
  },
  containerOutgoing: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  accent: {
    width: 3,
    borderRadius: 999,
    backgroundColor: colors.brandPrimary,
    marginRight: 6,
  },
  accentOutgoing: {
    backgroundColor: '#A7D3FF',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  sender: {
    ...typography.caption,
    color: colors.brandPrimary,
    fontWeight: '700',
    fontSize: 11,
  },
  senderOutgoing: {
    color: colors.surface,
  },
  preview: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
    fontSize: 11,
  },
  previewOutgoing: {
    color: 'rgba(255,255,255,0.88)',
  },
})

