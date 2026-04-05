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

/** Deterministic waveform seeded from messageId — 50 bars, natural-looking cluster heights. */
function seededWaveform(messageId: string, bars = 50): number[] {
  let seed = 0
  for (let i = 0; i < messageId.length; i += 1) {
    seed = (seed * 31 + messageId.charCodeAt(i)) >>> 0
  }
  const values: number[] = []
  for (let i = 0; i < bars; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const n = (seed % 1000) / 1000
    const peak = i % 9 === 0 ? 0.92 : i % 5 === 0 ? 0.72 : i % 3 === 0 ? 0.55 : 0.3
    const mixed = Math.max(0.12, Math.min(1, n * 0.55 + peak * 0.45))
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

/**
 * Sanitize a playback error into a single-line user-facing string.
 * Strips raw Java/ExoPlayer stack traces and file paths.
 */
function sanitizePlaybackError(raw: string): string {
  // Errors containing ExoPlayer / Android media-specific strings
  if (
    raw.includes('FileNotFoundException') ||
    raw.includes('FileDataSource') ||
    raw.includes('ExoPlaybackException') ||
    raw.includes('MediaCodec') ||
    raw.includes('com.google.') ||
    raw.includes('java.io.') ||
    raw.includes('android.') ||
    raw.includes('ExoPlayer') ||
    raw.length > 200
  ) {
    return "Couldn\u2019t play audio"
  }
  // Short, user-readable messages are fine to show
  return raw.length > 80 ? "Couldn\u2019t play audio" : raw
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
  const [playError, setPlayError] = useState<string | null>(null)

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
    setPlayError(null)
    const uriPreview = audioUrl.trim().slice(0, 160)
    try {
      if (isPlaying) {
        await pause()
      } else {
        await play(audioUrl.trim())
      }
    } catch (e) {
      const rawMsg = e instanceof Error ? e.message : String(e)
      console.error('[VoiceNoteBubble] playback failed', { uriPreview, rawMsg, messageId })
      setPlayError(sanitizePlaybackError(rawMsg))
    }
  }

  const currentSpeed = SPEED_STEPS[speedIndex]
  const speedLabel = currentSpeed === 1 ? '1\u00D7' : currentSpeed === 1.5 ? '1.5\u00D7' : '2\u00D7'

  // Colors derived from bubble direction
  const playIconColor = isOutgoing ? colors.brandPrimary : colors.surface
  const playBg = isOutgoing ? colors.surface : colors.brandPrimary
  const waveActive = isOutgoing ? 'rgba(255,255,255,0.92)' : 'rgba(46,74,89,0.88)'
  const waveInactive = isOutgoing ? 'rgba(255,255,255,0.32)' : 'rgba(46,74,89,0.18)'
  const metaColor = isOutgoing ? 'rgba(255,255,255,0.82)' : colors.textSecondary

  // Show elapsed time while playing, total duration at rest
  const durationLabel = (isPlaying || positionMs > 0) ? positionMs : effectiveDurationMs

  // WhatsApp: 10px solid white circle playhead
  const DOT_SIZE = 10
  const dotLeftPercent = Math.max(0, Math.min(100, progress * 100))

  // ── Fallback: no URL ────────────────────────────────────────────────────────
  if (!hasUrl) {
    return (
      <Pressable style={styles.root} onLongPress={onLongPress}>
        <View style={styles.topRow}>
          <View style={[styles.playButton, { backgroundColor: playBg, opacity: 0.5 }]}>
            <Ionicons name="mic-off-outline" size={18} color={playIconColor} />
          </View>
          <View style={styles.waveBlock} onLayout={onWaveLayout}>
            <View style={styles.waveTrack}>
              {bars.map((amp, index) => (
                <View key={`ph-${index}`} style={styles.waveBarCell}>
                  <View
                    style={[
                      styles.waveBarFill,
                      { height: amp < 0.25 ? 2 : 2 + Math.round(amp * 12), backgroundColor: waveInactive },
                    ]}
                  />
                </View>
              ))}
            </View>
          </View>
          <View style={styles.speedPlaceholder} />
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.durationText, { color: metaColor }]}>–:––</Text>
          <Text style={[styles.unavailableText, { color: metaColor }]}>Unavailable</Text>
          <View style={styles.timeStatusWrap}>
            <Text style={[styles.timestampText, { color: metaColor }]}>{timestamp}</Text>
          </View>
        </View>
      </Pressable>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <Pressable style={styles.root} onLongPress={onLongPress}>
      {/* ── Row 1: play button | waveform | speed ── */}
      <View style={styles.topRow}>
        {/* Play / pause button */}
        <Pressable
          style={[styles.playButton, { backgroundColor: playBg }]}
          onPress={() => void togglePlay()}
          hitSlop={8}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={playIconColor}
            style={isPlaying ? undefined : styles.playIconOffset}
          />
        </Pressable>

        {/* Waveform + scrub area */}
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
                      height: amp < 0.25 ? 2 : 2 + Math.round(amp * 14),
                      backgroundColor: index < activeBars ? waveActive : waveInactive,
                    },
                  ]}
                />
              </View>
            ))}
            {/* Progress playhead dot — always rendered, synced to real positionMs / durationMs */}
            <View
              style={[
                styles.progressDot,
                {
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_SIZE / 2,
                  top: '50%',
                  marginTop: -DOT_SIZE / 2,
                  left: `${dotLeftPercent}%`,
                  marginLeft: -DOT_SIZE / 2,
                },
              ]}
              pointerEvents="none"
            />
          </View>
        </View>

        {/* Speed toggle — only appears once this track is/was active */}
        {isActiveTrack ? (
          <Pressable style={styles.speedButton} onPress={cycleSpeed} hitSlop={8}>
            <Text style={[styles.speedText, { color: metaColor }]}>{speedLabel}</Text>
          </Pressable>
        ) : (
          <View style={styles.speedPlaceholder} />
        )}
      </View>

      {/* ── Error hint (sanitized — never raw exception text) ── */}
      {playError ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={12} color={metaColor} />
          <Text style={[styles.errorHint, { color: metaColor }]}>{playError}</Text>
        </View>
      ) : null}

      {/* ── Row 2: duration | timestamp + delivery ── */}
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
  // ── Top row ─────────────────────────────────────────────────────────────────
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playIconOffset: {
    marginLeft: 2,
  },
  // ── Waveform ─────────────────────────────────────────────────────────────────
  waveBlock: {
    flex: 1,
    minWidth: 56,
    minHeight: 24,
    justifyContent: 'center',
  },
  waveTrack: {
    height: 24,
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
    paddingHorizontal: 0.75,
  },
  waveBarFill: {
    width: '100%',
    maxWidth: 2,
    borderRadius: 1,
    minHeight: 2,
  },
  // ── Progress dot ─────────────────────────────────────────────────────────────
  progressDot: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  // ── Speed control ─────────────────────────────────────────────────────────────
  speedButton: {
    width: 34,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    flexShrink: 0,
  },
  speedPlaceholder: {
    width: 34,
    height: 22,
    flexShrink: 0,
  },
  speedText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  // ── Error hint ─────────────────────────────────────────────────────────────
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  errorHint: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 15,
  },
  // ── Metadata row ─────────────────────────────────────────────────────────────
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
  unavailableText: {
    ...typography.caption,
    fontSize: 11,
    flex: 1,
    textAlign: 'center',
    opacity: 0.7,
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
