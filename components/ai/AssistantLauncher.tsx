'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { authFetch } from '@/lib/auth/client'
import { AssistantPanel } from './AssistantPanel'

/**
 * Floating launcher for the AI assistant. Renders nothing unless the server
 * reports the assistant is configured (ANTHROPIC_API_KEY present), so the
 * button never appears when the feature can't work.
 */
export function AssistantLauncher() {
  const [configured, setConfigured] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    authFetch('/api/ai/assistant')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.configured) setConfigured(true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (!configured) return null

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[1090] flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-indigo-700"
          aria-label="Open AI assistant"
          title="AI assistant"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}
      <AssistantPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}
