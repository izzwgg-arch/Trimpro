import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, typography } from '../../theme/tokens'
import { useVoicePlaybackController } from '../../hooks/useVoicePlaybackController'
import { computeWaveformPlaybackFrame } from '../../screens/messages/message-thread-utils'

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

function seededWaveform(messageId: string, bars = 44): number[] {
  let seed = 0
  for (let i = 0; i < messageId.length; i += 1) {
    seed = (seed * 31 + messageId.charCodeAt(i)) >>> 0
  }
  const values: number[] = []
  for (let i = 0; i < bars; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const n = (seed % 1000) / 1000
    const peak = i % 11 === 0 ? 0.95 : i % 7 === 0 ? 0.78 : 0.52
    const mixed = Math.max(0.25, Math.min(1, n * 0.6 + peak * 0.4))
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

function speedToIndex(s: number): number {
  const i = SPEED_STEPS.indexOf(s as SpeedStep)
  return i >= 0 ? i : 0
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
  const { isPlaying, play, pause, seek, setSpeed, speed, positionMs, durationMs: liveDurationMs, isActiveTrack } =
    useVoicePlaybackController(messageId)
  const bars = useMemo(() => seededWaveform(messageId), [messageId])
  const [waveformWidth, setWaveformWidth] = useState(0)
  const [speedIndex, setSpeedIndex] = useState(0)
  const [playErrorMessage, setPlayErrorMessage] = useState<string | null>(null)

  const hasUrl = typeof audioUrl === 'string' && audioUrl.trim().length > 0
  const effectiveDurationMs = Math.max(1, liveDurationMs || durationMs || 1000)
  const { progress, activeBars } = computeWaveformPlaybackFrame({
    positionMs,
    durationMs: effectiveDurationMs,
    barsCount: bars.length,
    waveformWidth,
  })

  useEffect(() => {
    setSpeedIndex(speedToIndex(speed))
  }, [speed])

  const cycleSpeed = useCallback(() => {
    const next = (speedIndex + 1) % SPEED_STEPS.length
    setSpeedIndex(next)
    void setSpeed(SPEED_STEPS[next])
  }, [speedIndex, setSpeed])

  const seekFromTouch = (locationX: number) => {
    if (waveformWidth <= 0 || !hasUrl) return
    void seek(locationX / waveformWidth)
  }

  const onWaveLayout = (e: LayoutChangeEvent) => {
    setWaveformWidth(e.nativeEvent.layout.width)
  }

  const togglePlay = async () => {
    if (!hasUrl) return
    setPlayErrorMessage(null)
    const uriPreview = audioUrl.trim().slice(0, 160)
    try {
      if (isPlaying) {
        await pause()
      } else {
        await play(audioUrl.trim())
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[VoiceNoteBubble] playback failed', { uriPreview, message: msg, messageId })
      setPlayErrorMessage(msg)
    }
  }

  const currentSpeed = SPEED_STEPS[speedIndex]
  const speedLabel = currentSpeed === 1 ? '1\u00D7' : currentSpeed === 1.5 ? '1.5\u00D7' : '2\u00D7'

  const playColor = isOutgoing ? colors.brandPrimary : colors.surface
  const playBg = isOutgoing ? colors.surface : colors.brandPrimary
  const waveActive = isOutgoing ? 'rgba(255,255,255,0.92)' : 'rgba(46,74,89,0.88)'
  const waveInactive = isOutgoing ? 'rgba(255,255,255,0.34)' : 'rgba(46,74,89,0.2)'
  const metaColor = isOutgoing ? 'rgba(255,255,255,0.85)' : colors.textSecondary

  const showElapsed = isPlaying || positionMs > 0
  const durationLabel = showElapsed ? positionMs : effectiveDurationMs

  const dotSize = 6
  const dotLeftPercent = Math.max(0, Math.min(100, progress * 100))

  if (!hasUrl) {
    return (
      <Pressable style={styles.root} onLongPress={onLongPress}>
        <View style={styles.placeholderWave}>
          {bars.slice(0, 32).map((amp, index) => (
            <View key={`ph-${index}`} style={styles.waveBarCell}>
              <View style={[styles.waveBarFill, { height: 2 + Math.round(amp * 6), backgroundColor: waveInactive }]} />
            </View>
          ))}
        </View>
        <View style={styles.unavailableRow}>
          <Ionicons name="mic-off-outline" size={18} color={metaColor} />
          <Text style={[styles.unavailableText, { color: metaColor }]}>Voice message unavailable</Text>
        </View>
      </Pressable>
    )
  }

  return (
    <Pressable style={styles.root} onLongPress={onLongPress}>
      <View style={styles.topRow}>
        <Pressable style={[styles.playButton, { backgroundColor: playBg }]} onPress={() => void togglePlay()} hitSlop={6}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color={playColor} />
        </Pressable>

        <View
          style={styles.waveBlock}
          onLayout={onWaveLayout}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => seekFromTouch(e.nativeEvent.locationX)}
          onResponderMove={(e) => seekFromTouch(e.nativeEvent.locationX)}
        >
          <View style={styles.waveTrack}>
            {bars.map((amp, index) => (
              <View key={`${messageId}-b-${index}`} style={styles.waveBarCell}>
                <View
                  style={[
                    styles.waveBarFill,
                    {
                      height: 2 + Math.round(amp * 7),
                      backgroundColor: index < activeBars ? waveActive : waveInactive,
                    },
                  ]}
                />
              </View>
            ))}
            <View
              style={[
                styles.progressDot,
                isOutgoing ? styles.progressDotOutgoing : styles.progressDotIncoming,
                {
                  width: dotSize,
                  height: dotSize,
                  borderRadius: dotSize / 2,
                  top: '50%',
                  marginTop: -dotSize / 2,
                  left: `${dotLeftPercent}%`,
                  marginLeft: -dotSize / 2,
                },
              ]}
              pointerEvents="none"
            />
          </View>
        </View>

        {isActiveTrack ? (
          <Pressable style={styles.speedButton} onPress={cycleSpeed} hitSlop={8}>
            <Text style={[styles.speedText, { color: metaColor }]}>{speedLabel}</Text>
          </Pressable>
        ) : (
          <View style={styles.speedButton} />
        )}
      </View>

      {playErrorMessage ? (
        <Text style={[styles.errorHint, { color: metaColor }]} numberOfLines={3}>
          {playErrorMessage}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={[styles.durationText, { color: metaColor }]}>{formatDuration(durationLabel)}</Text>
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
    minHeight: 32,
  },
  placeholderWave: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: 18,
    marginBottom: 6,
    opacity: 0.85,
  },
  unavailableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  unavailableText: {
    ...typography.caption,
    fontSize: 13,
    flex: 1,
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
    minWidth: 56,
    minHeight: 18,
    justifyContent: 'center',
  },
  waveTrack: {
    height: 18,
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    position: 'relative',
  },
  waveBarCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0.5,
  },
  waveBarFill: {
    width: '100%',
    maxWidth: 1.5,
    borderRadius: 0.75,
    minHeight: 2,
  },
  progressDot: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0.5 },
    shadowOpacity: 0.18,
    shadowRadius: 1,
    elevation: 2,
  },
  progressDotOutgoing: {
    borderColor: 'rgba(0,0,0,0.2)',
  },
  progressDotIncoming: {
    borderColor: 'rgba(46,74,89,0.35)',
  },
  speedButton: {
    width: 32,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    flexShrink: 0,
  },
  speedText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  errorHint: {
    ...typography.caption,
    fontSize: 10,
    marginTop: 4,
    lineHeight: 14,
  },
  metaRow: {
    marginTop: 4,
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
