import React, { useMemo, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, typography } from '../../theme/tokens'
import { useVoicePlaybackController } from '../../hooks/useVoicePlaybackController'
import { computeWaveformPlaybackFrame } from '../../screens/messages/message-thread-utils'

interface VoiceNoteBubbleProps {
  messageId: string
  audioUrl: string
  durationMs?: number | null
  isOutgoing: boolean
  timestamp: string
  deliveryStatus?: string
  senderAvatarUrl?: string | null
  senderInitials?: string
}

function seededWaveform(messageId: string, bars = 48): number[] {
  let seed = 0
  for (let i = 0; i < messageId.length; i += 1) {
    seed = (seed * 31 + messageId.charCodeAt(i)) >>> 0
  }
  const values: number[] = []
  for (let i = 0; i < bars; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const n = (seed % 1000) / 1000
    const peak = i % 11 === 0 ? 0.95 : i % 7 === 0 ? 0.78 : 0.52
    const mixed = Math.max(0.22, Math.min(1, n * 0.6 + peak * 0.4))
    values.push(mixed)
  }
  return values
}

function statusIcon(status?: string) {
  if (status === 'READ') return '✓✓'
  if (status === 'DELIVERED') return '✓✓'
  return '✓'
}

function formatDuration(ms: number) {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const mins = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${mins}:${String(sec).padStart(2, '0')}`
}

export function VoiceNoteBubble({
  messageId,
  audioUrl,
  durationMs,
  isOutgoing,
  timestamp,
  deliveryStatus,
  senderAvatarUrl,
  senderInitials,
}: VoiceNoteBubbleProps) {
  const { isPlaying, play, pause, seek, positionMs, durationMs: liveDurationMs } = useVoicePlaybackController(messageId)
  const bars = useMemo(() => seededWaveform(messageId), [messageId])
  const [waveformWidth, setWaveformWidth] = useState(0)

  const effectiveDurationMs = Math.max(1, liveDurationMs || durationMs || 1000)
  const { activeBars: activeBarCount } = computeWaveformPlaybackFrame({
    positionMs,
    durationMs: effectiveDurationMs,
    barsCount: bars.length,
    waveformWidth,
  })

  const avatarLabel = (senderInitials || '?').slice(0, 1).toUpperCase()

  const seekFromTouch = (locationX: number) => {
    if (waveformWidth <= 0) return
    const ratio = locationX / waveformWidth
    void seek(ratio)
  }

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        {!isOutgoing ? (
          <View style={styles.avatarWrap}>
            {senderAvatarUrl ? (
              <Image source={{ uri: senderAvatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{avatarLabel}</Text>
            )}
          </View>
        ) : null}

        <Pressable
          style={[styles.playButton, isOutgoing && styles.playButtonOutgoing]}
          onPress={() => (isPlaying ? pause() : play(audioUrl))}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={isOutgoing ? colors.brandPrimary : colors.surface}
          />
        </Pressable>

        <View style={styles.waveBlock}>
          <View
            style={styles.waveTrack}
            onLayout={(event) => setWaveformWidth(event.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(event) => seekFromTouch(event.nativeEvent.locationX)}
            onResponderMove={(event) => seekFromTouch(event.nativeEvent.locationX)}
          >
            {bars.map((amp, index) => (
              <View
                key={`${messageId}-bar-${index}`}
                style={[
                  styles.waveBar,
                  {
                    height: 4 + Math.round(amp * 12),
                    backgroundColor:
                      index < activeBarCount
                        ? isOutgoing
                          ? 'rgba(255,255,255,0.96)'
                          : 'rgba(38,95,178,0.96)'
                        : isOutgoing
                          ? 'rgba(255,255,255,0.36)'
                          : 'rgba(38,95,178,0.32)',
                  },
                ]}
              />
            ))}
          </View>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.durationText, isOutgoing && styles.durationTextOutgoing]}>
          {formatDuration(effectiveDurationMs)}
        </Text>
        <View style={styles.timeStatusWrap}>
          <Text style={[styles.timestampText, isOutgoing && styles.timestampTextOutgoing]}>{timestamp}</Text>
          {isOutgoing ? (
            <Text style={[styles.statusText, deliveryStatus === 'READ' && styles.statusRead]}>
              {statusIcon(deliveryStatus)}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    marginTop: 2,
    width: '100%',
    paddingRight: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  avatarWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E3A8A',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarText: {
    ...typography.caption,
    color: colors.surface,
    fontWeight: '700',
  },
  playButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandPrimary,
  },
  playButtonOutgoing: {
    backgroundColor: colors.surface,
  },
  waveBlock: {
    flex: 1,
    minWidth: 0,
  },
  waveTrack: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    position: 'relative',
    overflow: 'hidden',
    paddingRight: 6,
  },
  waveBar: {
    width: 2,
    borderRadius: 1,
  },
  metaRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingRight: 2,
  },
  durationText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  durationTextOutgoing: {
    color: 'rgba(255,255,255,0.92)',
  },
  timeStatusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  timestampText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  timestampTextOutgoing: {
    color: 'rgba(255,255,255,0.92)',
  },
  statusText: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '700',
    marginTop: -1,
  },
  statusRead: {
    color: '#9BD0FF',
  },
})

