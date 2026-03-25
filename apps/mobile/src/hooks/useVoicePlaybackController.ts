import { useSyncExternalStore } from 'react'
import { Audio, AVPlaybackStatusSuccess } from 'expo-av'

type PlaybackSnapshot = {
  currentMessageId: string | null
  isPlaying: boolean
  positionMs: number
  durationMs: number
  speed: number
}

const listeners = new Set<() => void>()

let sound: Audio.Sound | null = null
let snapshot: PlaybackSnapshot = {
  currentMessageId: null,
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  speed: 1.0,
}

function emit() {
  for (const listener of listeners) listener()
}

function setSnapshot(partial: Partial<PlaybackSnapshot>) {
  snapshot = { ...snapshot, ...partial }
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return snapshot
}

function isLoadedStatus(status: any): status is AVPlaybackStatusSuccess {
  return !!status?.isLoaded
}

async function cleanupSound() {
  if (!sound) return
  try {
    await sound.unloadAsync()
  } catch {
    // Ignore unload errors.
  }
  sound = null
}

export async function playVoiceNote(messageId: string, audioUrl: string) {
  if (!messageId || !audioUrl) return

  if (sound && snapshot.currentMessageId === messageId) {
    const status = await sound.getStatusAsync()
    if (isLoadedStatus(status) && status.isPlaying) {
      await sound.pauseAsync()
      setSnapshot({ isPlaying: false, positionMs: status.positionMillis || 0, durationMs: status.durationMillis || 0 })
      return
    }
    if (isLoadedStatus(status)) {
      const duration = status.durationMillis || 0
      const position = status.positionMillis || 0
      const isAtEnd = duration > 0 && position >= Math.max(0, duration - 120)
      if (isAtEnd) {
        // Ensure replay works reliably after completion.
        await sound.setStatusAsync({ positionMillis: 0, shouldPlay: false, isLooping: false })
      }
    }
    await sound.playAsync()
    setSnapshot({ isPlaying: true })
    return
  }

  await cleanupSound()

  const created = await Audio.Sound.createAsync(
    { uri: audioUrl },
    { shouldPlay: true, progressUpdateIntervalMillis: 100, isLooping: false }
  )
  sound = created.sound

  setSnapshot({
    currentMessageId: messageId,
    isPlaying: true,
    positionMs: 0,
    durationMs: 0,
  })

  sound.setOnPlaybackStatusUpdate((status) => {
    if (!isLoadedStatus(status)) {
      return
    }
    const durationMs = status.durationMillis || snapshot.durationMs || 0
    const positionMs = status.positionMillis || 0
    if (status.didJustFinish) {
      // Explicitly stop autoplay/loop behavior at completion.
      void sound?.setStatusAsync({ shouldPlay: false, isLooping: false, positionMillis: 0 }).catch(() => {})
      setSnapshot({
        currentMessageId: messageId,
        isPlaying: false,
        positionMs: 0,
        durationMs,
      })
      return
    }
    setSnapshot({
      currentMessageId: messageId,
      isPlaying: status.isPlaying,
      positionMs,
      durationMs,
    })
  })
}

export async function pauseVoiceNote() {
  if (!sound) return
  const status = await sound.getStatusAsync()
  if (!isLoadedStatus(status) || !status.isPlaying) return
  await sound.pauseAsync()
  setSnapshot({
    isPlaying: false,
    positionMs: status.positionMillis || snapshot.positionMs,
    durationMs: status.durationMillis || snapshot.durationMs,
  })
}

export async function seekVoiceNote(messageId: string, ratio: number) {
  if (!sound || snapshot.currentMessageId !== messageId) return
  const status = await sound.getStatusAsync()
  if (!isLoadedStatus(status)) return
  const duration = status.durationMillis || snapshot.durationMs || 0
  if (duration <= 0) return

  const clampedRatio = Math.max(0, Math.min(1, ratio))
  const target = Math.round(duration * clampedRatio)
  await sound.setPositionAsync(target)
  setSnapshot({
    currentMessageId: messageId,
    isPlaying: status.isPlaying,
    positionMs: target,
    durationMs: duration,
  })
}

export async function setSpeedVoiceNote(messageId: string, rate: number) {
  if (!sound || snapshot.currentMessageId !== messageId) return
  const status = await sound.getStatusAsync()
  if (!isLoadedStatus(status)) return
  await sound.setRateAsync(rate, true)
  setSnapshot({ speed: rate })
}

export async function stopVoiceNote() {
  if (!sound) return
  try {
    await sound.stopAsync()
  } catch {
    // Ignore stop errors.
  }
  await cleanupSound()
  setSnapshot({
    currentMessageId: null,
    isPlaying: false,
    positionMs: 0,
    durationMs: 0,
  })
}

export function useVoicePlaybackController(messageId: string) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const isCurrent = state.currentMessageId === messageId
  return {
    isPlaying: isCurrent && state.isPlaying,
    positionMs: isCurrent ? state.positionMs : 0,
    durationMs: isCurrent ? state.durationMs : 0,
    speed: isCurrent ? state.speed : 1.0,
    currentPlayingMessageId: state.currentMessageId,
    play: (audioUrl: string) => playVoiceNote(messageId, audioUrl),
    pause: () => pauseVoiceNote(),
    seek: (ratio: number) => seekVoiceNote(messageId, ratio),
    setSpeed: (rate: number) => setSpeedVoiceNote(messageId, rate),
    stop: () => stopVoiceNote(),
  }
}

