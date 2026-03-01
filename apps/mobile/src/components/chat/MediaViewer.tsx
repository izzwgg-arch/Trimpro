import React from 'react'
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing } from '../../theme/tokens'

interface MediaViewerProps {
  visible: boolean
  uri: string
  fileName?: string | null
  kind: 'IMAGE' | 'VIDEO'
  onClose: () => void
}

export function MediaViewer({ visible, uri, fileName, kind, onClose }: MediaViewerProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Ionicons name="close" size={28} color={colors.surface} />
        </Pressable>
        {kind === 'IMAGE' ? (
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={styles.videoPlaceholder}>
            <Text style={styles.videoText}>Video playback not implemented</Text>
            <Text style={styles.videoSubtext}>Tap to open in browser</Text>
          </View>
        )}
        {fileName && (
          <View style={styles.footer}>
            <Text style={styles.fileName} numberOfLines={1}>
              {fileName}
            </Text>
          </View>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.md,
    zIndex: 1,
    padding: spacing.sm,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  videoText: {
    color: colors.surface,
    fontSize: 16,
  },
  videoSubtext: {
    color: colors.surface + 'CC',
    fontSize: 12,
  },
  footer: {
    position: 'absolute',
    bottom: spacing.xl,
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
  fileName: {
    color: colors.surface,
    fontSize: 14,
  },
})
