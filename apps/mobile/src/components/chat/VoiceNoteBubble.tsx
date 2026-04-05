import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Image, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, typography } from '../../theme/tokens'
import { useVoicePlaybackController } from '../../hooks/useVoicePlaybackController'
import { computeWaveformPlaybackFrame } from '../../screens/messages/message-thread-utils'

const SPEED_STEPS = [1, 1.5, 2] as const
type SpeedStep = (typeof SPEED_STEPS)[number]

// ── Slot / layout constants ────────────────────────────────────────────────
const LEFT_SLOT_SIZE = 42   // avatar or speed-badge circle width
const PLAY_BTN_SIZE  = 36   // play/pause circle diameter
const DOT_SIZE       = 10   // white progress playhead diameter
const WAVE_HEIGHT    = 28   // waveform track height in px

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

/**
 * Deterministic 50-bar waveform seeded from messageId.
 * Produces natural low/high clusters that look like real speech audio.
 */
function seededWaveform(messageId: string, bars = 50): number[] {
  let seed = 0
  for (let i = 0; i < messageId.length; i += 1) {
    seed = (seed * 31 + messageId.charCodeAt(i)) >>> 0
  }
  const values: number[] = []
  for (let i = 0; i < bars; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const n = (seed % 1000) / 1000
    const peak = i % 9 === 0 ? 0.95 : i % 5 === 0 ? 0.75 : i % 3 === 0 ? 0.55 : 0.28
    values.push(Math.max(0.1, Math.min(1, n * 0.5 + peak * 0.5)))
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

function sanitizePlaybackError(raw: string): string {
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
  return raw.length > 80 ? "Couldn\u2019t play audio" : raw
}

/**
 * Bar height per the WhatsApp reference:
 * - At rest (not the active track): all bars = tiny dots (3 px)
 * - Playing, played region (index < activeBars): tiny dots (already consumed)
 * - Playing, unplayed region (index >= activeBars): full amplitude bar
 */
function barHeight(amp: number, barIndex: number, activeBars: number, isActiveTrack: boolean): number {
  if (!isActiveTrack || barIndex < activeBars) {
    return 3 // tiny dot — at rest or already played
  }
  // Unplayed while playing: natural waveform height
  return amp < 0.15 ? 3 : Math.round(3 + amp * 22)
}

// ─────────────────────────────────────────────────────────────────────────────

export function VoiceNoteBubble({
  messageId,
  audioUrl,
  durationMs,
  isOutgoing,
  timestamp,
  deliveryStatus,
  senderAvatarUrl,
  senderInitials,
  onLongPress,
}: VoiceNoteBubbleProps) {
  const {
    isPlaying,
    play,
    pause,
    seek,
    setSpeed,
    speed,
    positionMs,
    durationMs: liveDurationMs,
    isActiveTrack,
  } = useVoicePlaybackController(messageId)

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

  useEffect(() => { setSpeedIndex(speedToIndex(speed)) }, [speed])

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

  // ── Derived colors ────────────────────────────────────────────────────────
  const playIconColor  = isOutgoing ? colors.brandPrimary : colors.surface
  const playBg         = isOutgoing ? 'rgba(255,255,255,0.90)' : colors.brandPrimary
  const waveActive     = isOutgoing ? 'rgba(255,255,255,0.90)' : 'rgba(46,74,89,0.85)'
  const waveInactive   = isOutgoing ? 'rgba(255,255,255,0.30)' : 'rgba(46,74,89,0.20)'
  const metaColor      = isOutgoing ? 'rgba(255,255,255,0.78)' : colors.textSecondary
  // Speed badge bg: a slightly darkened pill on the bubble surface
  const speedBadgeBg   = isOutgoing ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.07)'
  const speedBadgeText = isOutgoing ? 'rgba(255,255,255,0.92)' : colors.textPrimary

  const currentSpeed = SPEED_STEPS[speedIndex]
  const speedLabel = currentSpeed === 1 ? '1\u00D7' : currentSpeed === 1.5 ? '1.5\u00D7' : '2\u00D7'

  const durationLabel = (isPlaying || positionMs > 0) ? positionMs : effectiveDurationMs
  const dotLeftPercent = Math.max(0, Math.min(100, progress * 100))

  // ── LEFT SLOT ─────────────────────────────────────────────────────────────
  // When active: speed-toggle pill (pressable, far left)
  // When idle + incoming: sender avatar circle with mic badge
  // When idle + outgoing: plain mic-icon circle (same shape, consistent layout)
  const renderLeftSlot = () => {
    if (isActiveTrack) {
      return (
        <Pressable
          style={[styles.leftSlot, { backgroundColor: speedBadgeBg }]}
          onPress={cycleSpeed}
          hitSlop={6}
        >
          <Text style={[styles.speedText, { color: speedBadgeText }]}>{speedLabel}</Text>
        </Pressable>
      )
    }

    if (!isOutgoing) {
      // Incoming: show sender avatar
      return (
        <View style={styles.leftSlot}>
          {senderAvatarUrl ? (
            <Image source={{ uri: senderAvatarUrl }} style={styles.avatarImg} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: isOutgoing ? 'rgba(255,255,255,0.15)' : '#dbe7ef' }]}>
              <Text style={[styles.avatarInitial, { color: isOutgoing ? 'rgba(255,255,255,0.9)' : colors.brandPrimary }]}>
                {senderInitials || '?'}
              </Text>
            </View>
          )}
          {/* Mic badge overlay — bottom-right of avatar */}
          <View style={[styles.micBadge, { backgroundColor: isOutgoing ? 'rgba(255,255,255,0.22)' : colors.brandPrimary }]}>
            <Ionicons name="mic" size={8} color={isOutgoing ? colors.brandPrimary : '#fff'} />
          </View>
        </View>
      )
    }

    // Outgoing idle: mic icon in a subtle circle
    return (
      <View style={[styles.leftSlot, { backgroundColor: 'rgba(255,255,255,0.10)' }]}>
        <Ionicons name="mic" size={16} color="rgba(255,255,255,0.75)" />
      </View>
    )
  }

  // ── NO-URL FALLBACK ───────────────────────────────────────────────────────
  if (!hasUrl) {
    return (
      <Pressable style={styles.root} onLongPress={onLongPress}>
        <View style={styles.mainRow}>
          <View style={[styles.leftSlot, { backgroundColor: speedBadgeBg, opacity: 0.6 }]}>
            <Ionicons name="mic-off-outline" size={16} color={metaColor} />
          </View>
          <View style={[styles.playBtn, { backgroundColor: playBg, opacity: 0.5 }]}>
            <Ionicons name="play" size={14} color={playIconColor} style={styles.playIconOffset} />
          </View>
          <View style={styles.waveBlock} onLayout={onWaveLayout}>
            <View style={styles.waveTrack}>
              {bars.map((_, index) => (
                <View key={`ph-${index}`} style={styles.waveBarCell}>
                  <View style={[styles.waveBarFill, { height: 3, backgroundColor: waveInactive }]} />
                </View>
              ))}
            </View>
          </View>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.durationText, { color: metaColor }]}>–:––</Text>
          <View style={styles.timeStatusWrap}>
            <Text style={[styles.unavailableText, { color: metaColor }]}>Unavailable</Text>
            <Text style={[styles.timestampText, { color: metaColor }]}>{timestamp}</Text>
          </View>
        </View>
      </Pressable>
    )
  }

  // ── MAIN RENDER ──────────────────────────────────────────────────────────
  return (
    <Pressable style={styles.root} onLongPress={onLongPress}>

      {/* ── Row 1: [leftSlot] [play/pause] [waveform] ── */}
      <View style={styles.mainRow}>

        {/* LEFT SLOT — avatar (idle) or speed badge (active) */}
        {renderLeftSlot()}

        {/* PLAY / PAUSE */}
        <Pressable
          style={[styles.playBtn, { backgroundColor: playBg }]}
          onPress={() => void togglePlay()}
          hitSlop={10}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={14}
            color={playIconColor}
            style={isPlaying ? undefined : styles.playIconOffset}
          />
        </Pressable>

        {/* WAVEFORM + SCRUB + PROGRESS DOT */}
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
                      height: barHeight(amp, index, activeBars, isActiveTrack),
                      backgroundColor: index < activeBars ? waveActive : waveInactive,
                    },
                  ]}
                />
              </View>
            ))}

            {/* White progress playhead — synced to positionMs / durationMs */}
            <View
              style={[
                styles.progressDot,
                {
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_SIZE / 2,
                  top: '50%',
                  marginTop: -(DOT_SIZE / 2),
                  left: `${dotLeftPercent}%`,
                  marginLeft: -(DOT_SIZE / 2),
                },
              ]}
              pointerEvents="none"
            />
          </View>
        </View>

      </View>

      {/* ── Error hint (sanitized) ── */}
      {playError ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={11} color={metaColor} />
          <Text style={[styles.errorText, { color: metaColor }]}>{playError}</Text>
        </View>
      ) : null}

      {/* ── Row 2: duration | timestamp + delivery ── */}
      <View style={styles.metaRow}>
        <Text style={[styles.durationText, { color: metaColor }]}>{formatDuration(durationLabel)}</Text>
        <View style={styles.timeStatusWrap}>
          <Text style={[styles.timestampText, { color: metaColor }]}>{timestamp}</Text>
          {isOutgoing ? (
            <Text
              style={[
                styles.statusText,
                deliveryStatus === 'READ' && styles.statusRead,
                { color: metaColor },
              ]}
            >
              {statusIcon(deliveryStatus)}
            </Text>
          ) : null}
        </View>
      </View>

    </Pressable>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    marginTop: 2,
    width: '100%',
  },

  // ── Main content row ──────────────────────────────────────────────────────
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // ── Left slot (avatar / speed badge) ──────────────────────────────────────
  leftSlot: {
    width: LEFT_SLOT_SIZE,
    height: LEFT_SLOT_SIZE,
    borderRadius: LEFT_SLOT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  avatarImg: {
    width: LEFT_SLOT_SIZE,
    height: LEFT_SLOT_SIZE,
    borderRadius: LEFT_SLOT_SIZE / 2,
  },
  avatarFallback: {
    width: LEFT_SLOT_SIZE,
    height: LEFT_SLOT_SIZE,
    borderRadius: LEFT_SLOT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  micBadge: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -0.4,
  },

  // ── Play / pause button ────────────────────────────────────────────────────
  playBtn: {
    width: PLAY_BTN_SIZE,
    height: PLAY_BTN_SIZE,
    borderRadius: PLAY_BTN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playIconOffset: {
    marginLeft: 2,
  },

  // ── Waveform ──────────────────────────────────────────────────────────────
  waveBlock: {
    flex: 1,
    minWidth: 40,
    height: WAVE_HEIGHT,
    justifyContent: 'center',
  },
  waveTrack: {
    height: WAVE_HEIGHT,
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
    maxWidth: 2,
    borderRadius: 1,
    minHeight: 2,
  },

  // ── Progress dot ──────────────────────────────────────────────────────────
  progressDot: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },

  // ── Error ──────────────────────────────────────────────────────────────────
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingLeft: LEFT_SLOT_SIZE + 8 + PLAY_BTN_SIZE + 8,
  },
  errorText: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 15,
  },

  // ── Metadata row ──────────────────────────────────────────────────────────
  metaRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Indent duration to sit under the waveform, not the left slot
    paddingLeft: LEFT_SLOT_SIZE + 8 + PLAY_BTN_SIZE + 8,
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
    opacity: 0.65,
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
