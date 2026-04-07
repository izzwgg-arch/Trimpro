import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Image, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, typography } from '../../theme/tokens'
import { useVoicePlaybackController } from '../../hooks/useVoicePlaybackController'
import { computeWaveformPlaybackFrame } from '../../screens/messages/message-thread-utils'

const SPEED_STEPS = [1, 1.5, 2] as const
type SpeedStep = (typeof SPEED_STEPS)[number]

// ── Geometry constants — pixel-tuned to match WhatsApp reference ──────────
const AVATAR_SIZE   = 42   // left-slot circle (avatar or speed badge)
const PLAY_SIZE     = 28   // play/pause circle — same as before
const DOT_SIZE      = 9    // white progress playhead (9 px = crisper, closer to WA)
const WAVE_H        = 20   // waveform track height — slimmer strip feel
const ELEM_GAP      = 5    // 5 px between every element (tighter = more WA-like)
// Duration / timestamp indent: text baseline aligns with left edge of waveform
const META_INDENT   = AVATAR_SIZE + ELEM_GAP + PLAY_SIZE + ELEM_GAP  // 80 px

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

/** 44 deterministic amplitude values seeded from messageId.
 *  44 bars gives ~3.4 px/cell on a 150 px waveform, so bars are 2 px wide
 *  with ~1.4 px breathing room — matching the WA reference density. */
function seededWaveform(id: string, bars = 44): number[] {
  let seed = 0
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0
  return Array.from({ length: bars }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const n = (seed % 1000) / 1000
    const peak = (seed % 9 === 0) ? 0.95 : (seed % 5 === 0) ? 0.75 : (seed % 3 === 0) ? 0.55 : 0.28
    return Math.max(0.1, Math.min(1, n * 0.52 + peak * 0.48))
  })
}

function statusIcon(s?: string) {
  if (s === 'READ' || s === 'DELIVERED') return '\u{2713}\u{2713}'
  return '\u{2713}'
}

function formatMs(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function speedIdx(s: number) {
  const i = SPEED_STEPS.indexOf(s as SpeedStep)
  return i >= 0 ? i : 0
}

function sanitize(raw: string): string {
  if (
    raw.length > 200 ||
    raw.includes('FileNotFoundException') ||
    raw.includes('ExoPlaybackException') ||
    raw.includes('FileDataSource') ||
    raw.includes('MediaCodec') ||
    raw.includes('com.google.') ||
    raw.includes('java.io.') ||
    raw.includes('android.')
  ) return "Couldn\u2019t play audio"
  return raw.length > 80 ? "Couldn\u2019t play audio" : raw
}

/**
 * Bar height matching the WhatsApp reference visual logic:
 *   at rest / played  → 3 px uniform dot (consumed)
 *   unplayed region   → natural amplitude bar capped at 19 px (inside 20 px track)
 */
function barH(amp: number, idx: number, active: number, isCurrentTrack: boolean): number {
  if (!isCurrentTrack || idx < active) return 3
  return amp < 0.15 ? 3 : Math.round(3 + amp * 16)  // max ≈ 19 px, stays inside WAVE_H
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
    isPlaying, play, pause, seek, setSpeed,
    speed, positionMs, durationMs: liveDurationMs, isActiveTrack,
  } = useVoicePlaybackController(messageId)

  const bars = useMemo(() => seededWaveform(messageId), [messageId])
  const [waveW, setWaveW] = useState(0)
  const [spdIdx, setSpdIdx] = useState(0)
  const [playErr, setPlayErr] = useState<string | null>(null)

  const hasUrl  = typeof audioUrl === 'string' && audioUrl.trim().length > 0
  const effDur  = Math.max(1, liveDurationMs || durationMs || 1000)
  const { progress, activeBars } = computeWaveformPlaybackFrame({
    positionMs, durationMs: effDur, barsCount: bars.length, waveformWidth: waveW,
  })

  useEffect(() => { setSpdIdx(speedIdx(speed)) }, [speed])

  const cycleSpeed = useCallback(() => {
    const next = (spdIdx + 1) % SPEED_STEPS.length
    setSpdIdx(next)
    void setSpeed(SPEED_STEPS[next])
  }, [spdIdx, setSpeed])

  const seekAt = (x: number) => { if (waveW > 0 && hasUrl) void seek(x / waveW) }
  const onWaveLayout = (e: LayoutChangeEvent) => setWaveW(e.nativeEvent.layout.width)

  const togglePlay = async () => {
    if (!hasUrl) return
    setPlayErr(null)
    try {
      if (isPlaying) await pause()
      else await play(audioUrl.trim())
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      console.error('[VoiceNoteBubble]', { raw, messageId })
      setPlayErr(sanitize(raw))
    }
  }

  // ── Color scheme ─────────────────────────────────────────────────────────
  const out = isOutgoing
  // Play button: subtle transparent circle so the icon is the focus (like WA reference)
  const playBg        = out ? 'rgba(255,255,255,0.15)' : colors.brandPrimary
  const playIcon      = out ? 'rgba(255,255,255,0.95)' : '#FFFFFF'
  // Waveform: slightly bolder inactive bars so they read on teal background
  const waveActive    = out ? 'rgba(255,255,255,0.95)' : 'rgba(46,74,89,0.88)'
  const waveInactive  = out ? 'rgba(255,255,255,0.52)' : 'rgba(46,74,89,0.22)'
  const metaCol       = out ? 'rgba(255,255,255,0.75)' : colors.textSecondary
  // Speed badge
  const spdBg         = out ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.07)'
  const spdCol        = out ? '#FFFFFF'           : colors.textPrimary
  // Avatar fallback bg/text
  const avBg          = out ? 'rgba(255,255,255,0.18)' : '#dbe7ef'
  const avTxt         = out ? 'rgba(255,255,255,0.95)' : colors.brandPrimary
  // Mic badge on avatar
  const micBg         = out ? 'rgba(255,255,255,0.25)' : colors.brandPrimary
  const micIcon       = out ? colors.brandPrimary : '#fff'

  const currentSpeed  = SPEED_STEPS[spdIdx]
  const speedLabel    = currentSpeed === 1 ? '1\u00D7' : currentSpeed === 1.5 ? '1.5\u00D7' : '2\u00D7'
  const durLabel      = (isPlaying || positionMs > 0) ? positionMs : effDur
  const dotLeft       = Math.max(0, Math.min(100, progress * 100))

  // ── Left slot ─────────────────────────────────────────────────────────────
  // Active track → speed badge (pressable)
  // Idle (any direction) → sender avatar circle with mic badge
  const LeftSlot = () => {
    if (isActiveTrack) {
      return (
        <Pressable style={[styles.avatar, { backgroundColor: spdBg }]} onPress={cycleSpeed} hitSlop={6}>
          <Text style={[styles.speedText, { color: spdCol }]}>{speedLabel}</Text>
        </Pressable>
      )
    }
    return (
      <View style={styles.avatar}>
        {senderAvatarUrl ? (
          <Image source={{ uri: senderAvatarUrl }} style={styles.avatarImg} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: avBg }]}>
            <Text style={[styles.avatarInitial, { color: avTxt }]}>{senderInitials || '?'}</Text>
          </View>
        )}
        <View style={[styles.micBadge, { backgroundColor: micBg }]}>
          <Ionicons name="mic" size={8} color={micIcon} />
        </View>
      </View>
    )
  }

  // ── Fallback (no URL) ────────────────────────────────────────────────────
  if (!hasUrl) {
    return (
      <Pressable style={styles.root} onLongPress={onLongPress}>
        <View style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: spdBg, opacity: 0.6 }]}>
            <Ionicons name="mic-off-outline" size={16} color={metaCol} />
          </View>
          <View style={[styles.playBtn, { backgroundColor: playBg, opacity: 0.5 }]}>
            <Ionicons name="play" size={16} color={playIcon} style={styles.playOffset} />
          </View>
          <View style={styles.waveBlock} onLayout={onWaveLayout}>
            <View style={styles.waveTrack}>
              {bars.map((_, i) => (
                <View key={i} style={styles.barCell}>
                  <View style={[styles.barFill, { height: 3, backgroundColor: waveInactive }]} />
                </View>
              ))}
            </View>
          </View>
        </View>
        <View style={styles.meta}>
          <Text style={[styles.dur, { color: metaCol }]}>–:––</Text>
          <View style={styles.metaRight}>
            <Text style={[styles.ts, { color: metaCol }]}>Unavailable · {timestamp}</Text>
          </View>
        </View>
      </Pressable>
    )
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <Pressable style={styles.root} onLongPress={onLongPress}>

      {/* ── Main row: [avatar/speed] [play] [waveform] ── */}
      <View style={styles.row}>

        <LeftSlot />

        {/* Play / pause */}
        <Pressable
          style={[styles.playBtn, { backgroundColor: playBg }]}
          onPress={() => void togglePlay()}
          hitSlop={10}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={16}
            color={playIcon}
            style={isPlaying ? undefined : styles.playOffset}
          />
        </Pressable>

        {/* Waveform + progress dot */}
        <View
          style={styles.waveBlock}
          onLayout={onWaveLayout}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => seekAt(e.nativeEvent.locationX)}
          onResponderMove={(e) => seekAt(e.nativeEvent.locationX)}
        >
          <View style={styles.waveTrack}>
            {bars.map((amp, i) => (
              <View key={`${messageId}-${i}`} style={styles.barCell}>
                <View style={[
                  styles.barFill,
                  { height: barH(amp, i, activeBars, isActiveTrack), backgroundColor: i < activeBars ? waveActive : waveInactive },
                ]} />
              </View>
            ))}
            {/* White playhead dot — always present, synced to real positionMs */}
            <View
              style={[styles.dot, {
                width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2,
                top: '50%', marginTop: -(DOT_SIZE / 2),
                left: `${dotLeft}%`, marginLeft: -(DOT_SIZE / 2),
              }]}
              pointerEvents="none"
            />
          </View>
        </View>

      </View>

      {/* ── Error (sanitized) ── */}
      {playErr ? (
        <View style={styles.errRow}>
          <Ionicons name="alert-circle-outline" size={11} color={metaCol} />
          <Text style={[styles.errText, { color: metaCol }]}>{playErr}</Text>
        </View>
      ) : null}

      {/* ── Metadata row ── */}
      <View style={styles.meta}>
        <Text style={[styles.dur, { color: metaCol }]}>{formatMs(durLabel)}</Text>
        <View style={styles.metaRight}>
          <Text style={[styles.ts, { color: metaCol }]}>{timestamp}</Text>
          {isOutgoing ? (
            <Text style={[styles.check, deliveryStatus === 'READ' && styles.checkRead, { color: metaCol }]}>
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
    width: '100%',
    marginTop: 2,
  },

  // ── Main row ──────────────────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ELEM_GAP,
  },

  // ── Avatar / speed-badge slot (always AVATAR_SIZE × AVATAR_SIZE) ─────────
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  avatarImg: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  micBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 15,
    height: 15,
    borderRadius: 7.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: -0.5,
  },

  // ── Play / pause ──────────────────────────────────────────────────────────
  playBtn: {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    borderRadius: PLAY_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playOffset: { marginLeft: 1 },

  // ── Waveform ──────────────────────────────────────────────────────────────
  waveBlock: {
    flex: 1,
    height: WAVE_H,
    justifyContent: 'center',
    minWidth: 40,
  },
  waveTrack: {
    height: WAVE_H,
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    position: 'relative',
  },
  barCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // 0.75 px padding each side → ~1.5 px gap between 2 px bars (matches WA reference)
    paddingHorizontal: 0.75,
  },
  barFill: {
    // Hard 2 px — guaranteed regardless of cell math
    width: 2,
    borderRadius: 1,
    minHeight: 2,
  },

  // ── Progress dot ──────────────────────────────────────────────────────────
  dot: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 4,
  },

  // ── Error ──────────────────────────────────────────────────────────────────
  errRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
    paddingLeft: META_INDENT,
  },
  errText: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 15,
  },

  // ── Metadata ──────────────────────────────────────────────────────────────
  meta: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: META_INDENT,
  },
  dur: {
    ...typography.caption,
    fontSize: 11,
  },
  metaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ts: {
    ...typography.caption,
    fontSize: 11,
  },
  check: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    marginTop: -1,
  },
  checkRead: {
    color: '#9BD0FF',
  },
})
