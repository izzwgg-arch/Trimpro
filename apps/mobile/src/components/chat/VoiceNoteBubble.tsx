import React, { useCallback, useMemo, useState } from 'react'
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, typography } from '../../theme/tokens'
import { useVoicePlaybackController } from '../../hooks/useVoicePlaybackController'
import { computeWaveformPlaybackFrame } from '../../screens/messages/message-thread-utils'

const SCREEN_WIDTH = Dimensions.get('window').width

const SPEED_STEPS = [1, 1.5, 2] as const
type SpeedStep = (typeof SPEED_STEPS)[number]

interface VoiceNoteBubbleProps {
  messageId: string
  audioUrl: string
  durationMs?: number | null
  isOutgoing: boolean
  timestamp: string
  deliveryStatus?: string
  senderAvatarUrl?: string | null
  senderInitials?: string
  onLongPress?: () => void
}

function seededWaveform(messageId: string, bars = 40): number[] {
  let seed = 0
  for (let i = 0; i < messageId.length; i += 1) {
    seed = (seed * 31 + messageId.charCodeAt(i)) >>> 0
  }
  const values: number[] = []
  for (let i = 0; i < bars; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const n = (seed % 1000) / 1000
    const peak = i % 11 === 0 ? 0.95 : i % 7 === 0 ? 0.78 : 0.52
    const mixed = Math.max(0.2, Math.min(1, n * 0.6 + peak * 0.4))
    values.push(mixed)
  }
  return values
}

function statusIcon(status?: string) {
  if (status === 'READ') return '\u{2713}\u{2713}'
  if (status === 'DELIVERED') return '\u{2713}\u{2713}'
  return '\u{2713}'
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
  onLongPress,
}: VoiceNoteBubbleProps) {
  const { isPlaying, play, pause, seek, setSpeed, speed, positionMs, durationMs: liveDurationMs } =
    useVoicePlaybackController(messageId)
  const bars = useMemo(() => seededWaveform(messageId), [messageId])
  const [waveformWidth, setWaveformWidth] = useState(0)
  const [speedIndex, setSpeedIndex] = useState(0)

  const effectiveDurationMs = Math.max(1, liveDurationMs || durationMs || 1000)
  const { activeBars: activeBarCount } = computeWaveformPlaybackFrame({
    positionMs,
    durationMs: effectiveDurationMs,
    barsCount: bars.length,
    waveformWidth,
  })

  const cycleSpeed = useCallback(() => {
    const next = (speedIndex + 1) % SPEED_STEPS.length
    setSpeedIndex(next)
    void setSpeed(SPEED_STEPS[next])
  }, [speedIndex, setSpeed])

  const seekFromTouch = (locationX: number) => {
    if (waveformWidth <= 0) return
    void seek(locationX / waveformWidth)
  }

  const currentSpeed = SPEED_STEPS[speedIndex]
  const speedLabel = currentSpeed === 1 ? '1\u00D7' : currentSpeed === 1.5 ? '1.5\u00D7' : '2\u00D7'

  const playColor = isOutgoing ? colors.brandPrimary : colors.surface
  const playBg = isOutgoing ? colors.surface : colors.brandPrimary
  const waveActive = isOutgoing ? 'rgba(255,255,255,0.96)' : 'rgba(38,95,178,0.96)'
  const waveInactive = isOutgoing ? 'rgba(255,255,255,0.35)' : 'rgba(38,95,178,0.28)'
  const metaColor = isOutgoing ? 'rgba(255,255,255,0.85)' : colors.textSecondary

  return (
    <Pressable
      style={styles.root}
      onLongPress={onLongPress}
    >
      <View style={styles.topRow}>
        <Pressable
          style={[styles.playButton, { backgroundColor: playBg }]}
          onPress={() => (isPlaying ? pause() : play(audioUrl))}
          hitSlop={6}
        >
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color={playColor} />
        </Pressable>

        <View
          style={styles.waveBlock}
          onLayout={(e) => setWaveformWidth(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => seekFromTouch(e.nativeEvent.locationX)}
          onResponderMove={(e) => seekFromTouch(e.nativeEvent.locationX)}
        >
          <View style={styles.waveTrack}>
            {bars.map((amp, index) => (
              <View
                key={`${messageId}-b-${index}`}
                style={[
                  styles.waveBar,
                  {
                    height: 3 + Math.round(amp * 14),
                    backgroundColor: index < activeBarCount ? waveActive : waveInactive,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {isPlaying ? (
          <Pressable style={styles.speedButton} onPress={cycleSpeed} hitSlop={8}>
            <Text style={[styles.speedText, { color: metaColor }]}>{speedLabel}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.durationText, { color: metaColor }]}>
          {formatDuration(isPlaying ? positionMs : effectiveDurationMs)}
        </Text>
        <View style={styles.timeStatusWrap}>
          <Text style={[styles.timestampText, { color: metaColor }]}>{timestamp}</Text>
          {isOutgoing ? (
            <Text style={[styles.statusText, deliveryStatus === 'READ' && styles.statusRead, { color: metaColor }]}>
              {statusIcon(deliveryStatus)}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    marginTop: 2,
    width: '100%',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  waveBlock: {
    flex: 1,
    minWidth: 0,
  },
  waveTrack: {
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  waveBar: {
    width: 2,
    borderRadius: 1,
    flexShrink: 0,
  },
  speedButton: {
    width: 30,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    flexShrink: 0,
  },
  speedText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  metaRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  durationText: {
    ...typography.caption,
    fontSize: 11,
  },
  timeStatusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  timestampText: {
    ...typography.caption,
    fontSize: 11,
  },
  statusText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    marginTop: -1,
  },
  statusRead: {
    color: '#9BD0FF',
  },
})