'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Send, X, Loader2, Mail, Check, AlertCircle } from 'lucide-react'
import { authFetch } from '@/lib/auth/client'

interface PendingConfirmation {
  type: 'send_estimate'
  estimateId: string
  estimateNumber?: string | null
  recipient?: string | null
  total?: string | null
}
interface GeneratedImage {
  url: string
  prompt: string
}
type Bubble = {
  role: 'user' | 'assistant'
  text: string
  images?: GeneratedImage[]
  confirmations?: PendingConfirmation[]
}

const EXAMPLES = [
  'Open the production board',
  'Look up the customer John Smith',
  'Create an estimate for 40ft of oak railing at $95/ft',
  'Generate a concept image of a modern cable railing on a deck',
]

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  // `thread` is the raw Anthropic message history we resend each turn for context.
  const [thread, setThread] = useState<any[]>([])
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendState, setSendState] = useState<Record<string, 'sending' | 'sent' | 'error'>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [bubbles, loading])

  const send = async (presetText?: string) => {
    const text = (presetText ?? input).trim()
    if (!text || loading) return
    setInput('')
    setBubbles((b) => [...b, { role: 'user', text }])
    setLoading(true)
    const nextThread = [...thread, { role: 'user', content: text }]
    try {
      const res = await authFetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextThread }),
      })
      if (res.status === 503) {
        const j = await res.json().catch(() => ({}))
        setBubbles((b) => [...b, { role: 'assistant', text: j.message || 'The assistant isn’t set up yet.' }])
        return
      }
      if (!res.ok) {
        setBubbles((b) => [...b, { role: 'assistant', text: 'Something went wrong. Please try again.' }])
        return
      }
      const data = await res.json()
      setThread(data.messages || nextThread)
      setBubbles((b) => [
        ...b,
        {
          role: 'assistant',
          text: data.reply || '…',
          images: data.images,
          confirmations: data.pendingConfirmations,
        },
      ])
      // If the assistant opened a screen, navigate and close the panel.
      if (data.navigation?.path) {
        router.push(data.navigation.path)
        setTimeout(() => onClose(), 150)
      }
    } catch {
      setBubbles((b) => [...b, { role: 'assistant', text: 'Network error. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  const confirmSend = async (c: PendingConfirmation) => {
    setSendState((s) => ({ ...s, [c.estimateId]: 'sending' }))
    try {
      const body: any = {}
      if (c.recipient) body.emails = [c.recipient]
      const res = await authFetch(`/api/estimates/${c.estimateId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setSendState((s) => ({ ...s, [c.estimateId]: res.ok ? 'sent' : 'error' }))
    } catch {
      setSendState((s) => ({ ...s, [c.estimateId]: 'error' }))
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1100] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-900">Trimpro Assistant</div>
            <div className="text-[11px] text-gray-500">Opens screens, looks up customers, drafts estimates, schedules jobs</div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
            aria-label="Close assistant"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-4">
          {bubbles.length === 0 && (
            <div className="mt-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-gray-700">How can I help?</p>
              <p className="mb-4 mt-1 text-xs text-gray-500">Try one of these:</p>
              <div className="space-y-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => send(ex)}
                    className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-700 hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {bubbles.map((b, i) => (
            <div key={i} className={b.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  b.role === 'user'
                    ? 'rounded-br-md bg-indigo-600 text-white'
                    : 'rounded-bl-md border border-gray-200 bg-white text-gray-800'
                }`}
              >
                <div className="whitespace-pre-wrap break-words">{b.text}</div>

                {b.images?.map((img, k) => (
                  <figure key={k} className="mt-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.prompt} className="w-full rounded-lg border border-gray-200" />
                    <figcaption className="mt-1 text-[11px] italic text-gray-500">Concept image — not to scale</figcaption>
                  </figure>
                ))}

                {b.confirmations?.map((c, k) => {
                  const state = sendState[c.estimateId]
                  return (
                    <div key={k} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-gray-800">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                        <Mail className="h-3.5 w-3.5" /> Ready to send
                        {c.estimateNumber ? ` ${c.estimateNumber}` : ' estimate'}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        To: {c.recipient || "the customer's email on file"}
                        {c.total ? ` · Total: $${c.total}` : ''}
                      </div>
                      {state === 'sent' ? (
                        <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-green-700">
                          <Check className="h-3.5 w-3.5" /> Sent
                        </div>
                      ) : state === 'error' ? (
                        <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-700">
                          <AlertCircle className="h-3.5 w-3.5" /> Couldn’t send — try from the estimate page
                        </div>
                      ) : (
                        <button
                          onClick={() => confirmSend(c)}
                          disabled={state === 'sending'}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                          {state === 'sending' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          {state === 'sending' ? 'Sending…' : 'Send now'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-gray-200 bg-white p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={1}
              placeholder="Ask the assistant…"
              className="max-h-32 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-gray-400">
            The assistant can act on your behalf within your Trimpro permissions. It won’t send anything to a customer without your confirmation.
          </p>
        </div>
      </div>
    </div>
  )
}
