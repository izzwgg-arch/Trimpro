'use client'

import { refreshAccessToken } from '@/lib/auth/client'

/**
 * Browser helpers for video calls. The same call page runs in the dashboard (token in
 * localStorage) and inside the phone app's WebView (token handed in by the app).
 */

type CallWindow = Window & {
  __TRIMPRO_CALL_TOKEN__?: string
  ReactNativeWebView?: { postMessage: (message: string) => void }
}

export function isInApp() {
  return typeof window !== 'undefined' && !!(window as CallWindow).ReactNativeWebView
}

/** Tell the phone app something (call closed, token expired); no-op in a browser. */
export function postToApp(message: Record<string, unknown>) {
  const w = window as CallWindow
  w.ReactNativeWebView?.postMessage(JSON.stringify(message))
}

function currentToken() {
  const w = window as CallWindow
  return w.__TRIMPRO_CALL_TOKEN__ || localStorage.getItem('accessToken') || ''
}

/** Waits for the app to hand in a fresh token (it listens for `token-expired`). */
function waitForAppToken(previous: string, ms = 8000) {
  return new Promise<boolean>((resolve) => {
    const started = Date.now()
    postToApp({ type: 'token-expired' })
    const timer = setInterval(() => {
      const token = currentToken()
      if (token && token !== previous) {
        clearInterval(timer)
        resolve(true)
      } else if (Date.now() - started > ms) {
        clearInterval(timer)
        resolve(false)
      }
    }, 200)
  })
}

async function renewToken(previous: string) {
  return isInApp() ? waitForAppToken(previous) : refreshAccessToken()
}

export async function callFetch(url: string, init: RequestInit = {}) {
  const send = (token: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    })
  let token = currentToken()
  let res = await send(token)
  if (res.status === 401 && (await renewToken(token))) {
    token = currentToken()
    res = await send(token)
  }
  return res
}

export async function callJson<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await callFetch(url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data as T
}

/**
 * Reads the call's event stream with fetch (so the token stays in a header) and calls
 * onEvent for each `event:` block. Resolves when the server closes the stream.
 */
export async function readCallStream(
  url: string,
  onEvent: (event: string, data: any) => void,
  signal: AbortSignal
) {
  const res = await callFetch(url, { signal, headers: { Accept: 'text/event-stream' } })
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let split: number
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      let event = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data) continue
      try {
        onEvent(event, JSON.parse(data))
      } catch {
        // ignore a malformed block
      }
    }
  }
}

/** Start a call and open the call window. Must be called from a click so the popup isn't blocked. */
export async function startVideoCall(target: { conversationId?: string; calleeId?: string }, video = true) {
  const popup = window.open('about:blank', 'trimpro-call', 'width=980,height=720')
  try {
    const data = await callJson<{ call: { id: string } }>('/api/video-calls', { ...target, video })
    const url = `/call/${data.call.id}`
    if (popup) popup.location.href = url
    else window.location.href = url
    return data.call.id
  } catch (error) {
    popup?.close()
    throw error
  }
}

export function openCallWindow(callId: string) {
  const popup = window.open(`/call/${callId}`, 'trimpro-call', 'width=980,height=720')
  if (!popup) window.location.href = `/call/${callId}`
}

/**
 * Repeating two-tone ring made with Web Audio (no sound files).
 * kind 'incoming' is the phone-style ring, 'outgoing' the softer ringback the caller hears.
 */
export function startTone(kind: 'incoming' | 'outgoing') {
  let ctx: AudioContext | null = null
  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  } catch {
    return () => {}
  }
  const audio = ctx
  const gain = audio.createGain()
  gain.gain.value = 0
  gain.connect(audio.destination)
  const freqs = kind === 'incoming' ? [480, 620] : [440, 480]
  const oscillators = freqs.map((f) => {
    const o = audio.createOscillator()
    o.frequency.value = f
    o.connect(gain)
    o.start()
    return o
  })
  const level = kind === 'incoming' ? 0.12 : 0.06
  const pattern = kind === 'incoming' ? [0, 0.4, 0.6, 1.0] : [0, 1.5] // on/off pairs within a cycle
  const cycle = kind === 'incoming' ? 3 : 4
  let stopped = false
  const schedule = () => {
    if (stopped) return
    const t0 = audio.currentTime + 0.05
    for (let i = 0; i < pattern.length; i += 2) {
      gain.gain.setValueAtTime(level, t0 + pattern[i])
      gain.gain.setValueAtTime(0, t0 + pattern[i + 1])
    }
  }
  schedule()
  const timer = setInterval(schedule, cycle * 1000)
  void audio.resume().catch(() => null)
  return () => {
    stopped = true
    clearInterval(timer)
    oscillators.forEach((o) => {
      try {
        o.stop()
      } catch {}
    })
    void audio.close().catch(() => null)
  }
}
