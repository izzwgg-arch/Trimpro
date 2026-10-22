import React, { useRef, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av'
import { SwipePager } from '../attachments/SwipePager'
import { colors, spacing } from '../../theme/tokens'

export interface MediaViewerItem {
  uri: string
  fileName?: string | null
  kind: 'IMAGE' | 'VIDEO'
}

interface MediaViewerProps {
  visible: boolean
  /** Every photo/video in the conversation, oldest first. */
  items: MediaViewerItem[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}

function MediaItem({ item }: { item: MediaViewerItem }) {
  const videoRef = useRef<Video>(null)
  const [videoLoading, setVideoLoading] = useState(true)
  const [videoError, setVideoError] = useState(false)

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setVideoLoading(false)
      setVideoError(false)
    }
  }

  if (item.kind === 'IMAGE') {
    return (
      <View style={styles.itemWrap}>
        <Image source={{ uri: item.uri }} style={styles.image} resizeMode="contain" />
      </View>
    )
  }
  if (videoError) {
    return (
      <View style={styles.itemWrap}>
        <View style={styles.videoPlaceholder}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.surface + 'AA'} />
          <Text style={styles.videoText}>Unable to play video</Text>
        </View>
      </View>
    )
  }
  return (
    <View style={styles.itemWrap}>
      <View style={styles.videoWrap}>
        {videoLoading && (
          <View style={styles.videoLoadingOverlay}>
            <ActivityIndicator size="large" color={colors.surface} />
          </View>
        )}
        <Video
          ref={videoRef}
          source={{ uri: item.uri }}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls
          shouldPlay
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
          onError={() => {
            setVideoLoading(false)
            setVideoError(true)
          }}
        />
      </View>
    </View>
  )
}

export function MediaViewer({ visible, items, index, onIndexChange, onClose }: MediaViewerProps) {
  const total = items.length
  const safeIndex = total > 0 ? ((index % total) + total) % total : 0
  const current = total > 0 ? items[safeIndex] : null

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <SwipePager
          count={total}
          index={safeIndex}
          onIndexChange={onIndexChange}
          renderItem={(i) => <MediaItem key={`${i}:${items[i].uri}`} item={items[i]} />}
        />
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Ionicons name="close" size={28} color={colors.surface} />
        </Pressable>
        {current && (
          <View style={styles.footer} pointerEvents="none">
            {current.fileName ? (
              <Text style={styles.fileName} numberOfLines={1}>
                {current.fileName}
              </Text>
            ) : null}
            {total > 1 ? <Text style={styles.counter}>{`${safeIndex + 1} of ${total}`}</Text> : null}
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
  },
  itemWrap: {
    flex: 1,
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
  videoWrap: {
    width: '100%',
    height: '80%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  videoLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
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
  footer: {
    position: 'absolute',
    bottom: spacing.xl + 14,
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  fileName: {
    color: colors.surface,
    fontSize: 14,
  },
  counter: {
    color: colors.surface + 'AA',
    fontSize: 12,
  },
})
