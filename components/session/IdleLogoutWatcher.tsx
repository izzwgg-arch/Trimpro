'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Show an "Are you still here?" prompt after this much inactivity, then log the
// user out if they do not respond before the countdown ends.
const IDLE_LIMIT_MS = 2.5 * 60 * 60 * 1000 // 2 hours 30 minutes
const COUNTDOWN_SECONDS = 60

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel', 'click'] as const

export function IdleLogoutWatcher() {
  const [prompting, setPrompting] = useState(false)
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS)

  const lastActivityRef = useRef<number>(Date.now())
  const promptStartRef = useRef<number>(0)
  const promptingRef = useRef(false)
  const loggingOutRef = useRef(false)

  const logout = useCallback(async () => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    try {
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => {})
      }
    } finally {
      try {
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        localStorage.removeItem('user')
      } catch {}
      // Remember where they were so login can send them back after re-auth.
      try {
        sessionStorage.setItem('trimpro:idleLoggedOut', '1')
      } catch {}
      window.location.href = '/auth/login'
    }
  }, [])

  const dismiss = useCallback(() => {
    promptingRef.current = false
    setPrompting(false)
    lastActivityRef.current = Date.now()
  }, [])

  // Track activity (ignored while the prompt is open — the user must respond).
  useEffect(() => {
    const onActivity = () => {
      if (promptingRef.current) return
      lastActivityRef.current = Date.now()
    }
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true })
    }
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity)
    }
  }, [])

  // One-second tick drives both the idle check and the countdown. Using wall-clock
  // timestamps keeps it correct even when the tab is backgrounded/throttled.
  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      if (!promptingRef.current) {
        if (now - lastActivityRef.current >= IDLE_LIMIT_MS) {
          promptingRef.current = true
          promptStartRef.current = now
          setRemaining(COUNTDOWN_SECONDS)
          setPrompting(true)
        }
        return
      }
      const elapsed = Math.floor((now - promptStartRef.current) / 1000)
      const left = COUNTDOWN_SECONDS - elapsed
      setRemaining(left > 0 ? left : 0)
      if (left <= 0) {
        void logout()
      }
    }
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [logout])

  if (!prompting) return null

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-title"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl text-center">
        <h2 id="idle-title" className="text-xl font-bold text-gray-900">
          Are you still here?
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          You&apos;ve been inactive for a while. For your security you&apos;ll be signed out in
        </p>
        <div className="my-4 text-5xl font-bold tabular-nums text-red-600">{remaining}</div>
        <p className="text-xs text-gray-500">seconds</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            I&apos;m still here
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Log out now
          </button>
        </div>
      </div>
    </div>
  )
}
