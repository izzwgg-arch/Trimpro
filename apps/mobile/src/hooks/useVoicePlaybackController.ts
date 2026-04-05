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

function logVoicePlayback(stage: string, payload: Record<string, unknown>) {
  console.error(`[VoicePlayback] ${stage}`, payload)
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

async function ensurePlaybackMode() {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    })
  } catch (e) {
    logVoicePlayback('setAudioModeAsync', { error: String(e) })
  }
}

export async function playVoiceNote(messageId: string, audioUrl: string) {
  const uri = String(audioUrl ?? '').trim()
  if (!messageId || !uri) {
    const err = new Error('Missing messageId or audio URL')
    logVoicePlayback('invalidInput', { messageId, uriPreview: uri.slice(0, 80) })
    throw err
  }

  if (sound && snapshot.currentMessageId === messageId) {
    const status = await sound.getStatusAsync()
    if (isLoadedStatus(status) && status.isPlaying) {
      await sound.pauseAsync()
      setSnapshot({
        isPlaying: false,
        positionMs: status.positionMillis || 0,
        durationMs: status.durationMillis || 0,
      })
      return
    }
    if (isLoadedStatus(status)) {
      const duration = status.durationMillis || 0
      const position = status.positionMillis || 0
      const isAtEnd = duration > 0 && position >= Math.max(0, duration - 120)
      if (isAtEnd) {
        await sound.setStatusAsync({ positionMillis: 0, shouldPlay: false, isLooping: false })
      }
    }
    await ensurePlaybackMode()
    try {
      await sound.playAsync()
      setSnapshot({ isPlaying: true })
    } catch (e) {
      logVoicePlayback('resumePlayFailed', { uri: uri.slice(0, 160), error: String(e) })
      throw e instanceof Error ? e : new Error(String(e))
    }
    return
  }

  await cleanupSound()
  await ensurePlaybackMode()

  let newSound: Audio.Sound
  try {
    const created = await Audio.Sound.createAsync(
      { uri },
      {
        shouldPlay: false,
        progressUpdateIntervalMillis: 50,
        isLooping: false,
        volume: 1.0,
      }
    )
    newSound = created.sound
  } catch (e) {
    logVoicePlayback('createAsync threw', {
      uri: uri.slice(0, 200),
      messageId,
      error: String(e),
    })
    throw e instanceof Error ? e : new Error(String(e))
  }

  const statusAfterCreate = await newSound.getStatusAsync()
  if (!isLoadedStatus(statusAfterCreate)) {
    const errDetail =
      'error' in statusAfterCreate && statusAfterCreate.error
        ? String(statusAfterCreate.error)
        : 'Audio source did not load (invalid URL, network, or format)'
    logVoicePlayback('notLoadedAfterCreate', {
      uri: uri.slice(0, 200),
      messageId,
      status: JSON.stringify(statusAfterCreate),
    })
    try {
      await newSound.unloadAsync()
    } catch {
      /* ignore */
    }
    throw new Error(errDetail)
  }

  sound = newSound

  setSnapshot({
    currentMessageId: messageId,
    isPlaying: false,
    positionMs: statusAfterCreate.positionMillis || 0,
    durationMs: statusAfterCreate.durationMillis || 0,
  })

  newSound.setOnPlaybackStatusUpdate((st) => {
    if (!isLoadedStatus(st)) {
      if ('error' in st && st.error) {
        logVoicePlayback('playbackStatusError', { error: String(st.error), messageId })
      }
      return
    }
    const durationMs = st.durationMillis || snapshot.durationMs || 0
    const positionMs = st.positionMillis || 0
    if (st.didJustFinish) {
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
      isPlaying: st.isPlaying,
      positionMs,
      durationMs,
    })
  })

  try {
    await newSound.playAsync()
    setSnapshot({ isPlaying: true })
  } catch (e) {
    logVoicePlayback('playAsyncFailed', { uri: uri.slice(0, 200), error: String(e) })
    await cleanupSound()
    setSnapshot({
      currentMessageId: null,
      isPlaying: false,
      positionMs: 0,
      durationMs: 0,
    })
    throw e instanceof Error ? e : new Error(String(e))
  }
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
    isActiveTrack: isCurrent,
    currentPlayingMessageId: state.currentMessageId,
    play: (url: string) => playVoiceNote(messageId, url),
    pause: () => pauseVoiceNote(),
    seek: (ratio: number) => seekVoiceNote(messageId, ratio),
    setSpeed: (rate: number) => setSpeedVoiceNote(messageId, rate),
    stop: () => stopVoiceNote(),
  }
}
