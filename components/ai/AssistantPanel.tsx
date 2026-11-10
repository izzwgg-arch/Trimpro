'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Sparkles, Send, X, Loader2, Mail, Check, AlertCircle, ImagePlus } from 'lucide-react'
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
/** A photo the user attached to a message (held client-side as a data URL + raw base64). */
interface Attachment {
  dataUrl: string
  base64: string
  mediaType: string
  name: string
}
type Bubble = {
  role: 'user' | 'assistant'
  text: string
  images?: GeneratedImage[]
  attachments?: string[] // data URLs, for display on the user's own bubble
  confirmations?: PendingConfirmation[]
}

const EXAMPLES = [
  'Open the production board',
  'Look up the customer John Smith',
  'Create an estimate for 40ft of oak railing at $95/ft',
  'Attach a photo of a supplier quote and say "add these to this estimate"',
]

const MAX_IMAGE_DIM = 1536

/** Downscale a picked image and return its base64 (JPEG) so payloads/token use stay reasonable. */
async function fileToAttachment(file: File): Promise<Attachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = dataUrl
  })
  let { width, height } = img
  if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
    const scale = MAX_IMAGE_DIM / Math.max(width, height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  let outUrl = dataUrl
  if (ctx) {
    ctx.drawImage(img, 0, 0, width, height)
    outUrl = canvas.toDataURL('image/jpeg', 0.85)
  }
  const base64 = outUrl.includes(',') ? outUrl.split(',')[1] : outUrl
  const mediaType = outUrl.startsWith('data:') ? outUrl.slice(5, outUrl.indexOf(';')) : 'image/jpeg'
  return { dataUrl: outUrl, base64, mediaType, name: file.name }
}

/** Figure out whether the user is currently viewing a specific estimate or invoice. */
function openRecordContext(pathname: string | null): { openEstimateId?: string; openInvoiceId?: string } {
  if (!pathname) return {}
  const seg = pathname.split('/').filter(Boolean) // ['dashboard','estimates','<id>']
  if (seg[0] !== 'dashboard' || !seg[2] || seg[2] === 'new') return {}
  if (seg[1] === 'estimates') return { openEstimateId: seg[2] }
  if (seg[1] === 'invoices') return { openInvoiceId: seg[2] }
  return {}
}

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  // `thread` is the raw Anthropic message history we resend each turn for context.
  const [thread, setThread] = useState<any[]>([])
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attaching, setAttaching] = useState(false)
  const [sendState, setSendState] = useState<Record<string, 'sending' | 'sent' | 'error'>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [bubbles, loading])

  const onPickFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    setAttaching(true)
    try {
      const picked = Array.from(fileList).filter((f) => f.type.startsWith('image/')).slice(0, 4)
      const mapped = await Promise.all(picked.map((f) => fileToAttachment(f)))
      setAttachments((a) => [...a, ...mapped].slice(0, 4))
    } catch {
      /* ignore bad files */
    } finally {
      setAttaching(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const send = async (presetText?: string) => {
    const text = (presetText ?? input).trim()
    const imgs = attachments
    if ((!text && imgs.length === 0) || loading) return
    setInput('')
    setAttachments([])
    setBubbles((b) => [...b, { role: 'user', text, attachments: imgs.map((a) => a.dataUrl) }])
    setLoading(true)

    // Build this turn's content: plain string when no images, else text + image blocks.
    const content: any =
      imgs.length === 0
        ? text
        : [
            ...(text ? [{ type: 'text', text }] : []),
            ...imgs.map((a) => ({
              type: 'image',
              source: { type: 'base64', media_type: a.mediaType, data: a.base64 },
            })),
          ]
    const nextThread = [...thread, { role: 'user', content }]
    try {
      const res = await authFetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextThread, context: openRecordContext(pathname) }),
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
            <div className="text-[11px] text-gray-500">Reads photos, drafts & adds to estimates/invoices, looks up customers, opens screens</div>
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
                {b.text && <div className="whitespace-pre-wrap break-words">{b.text}</div>}

                {b.attachments && b.attachments.length > 0 && (
                  <div className={`flex flex-wrap gap-1.5 ${b.text ? 'mt-2' : ''}`}>
                    {b.attachments.map((src, k) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={k}
                        src={src}
                        alt="attachment"
                        className="h-20 w-20 rounded-lg border border-white/30 object-cover"
                      />
                    ))}
                  </div>
                )}

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
          {/* Pending photo attachments */}
          {(attachments.length > 0 || attaching) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {attachments.map((a, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.dataUrl} alt={a.name} className="h-14 w-14 rounded-lg border border-gray-200 object-cover" />
                  <button
                    onClick={() => setAttachments((arr) => arr.filter((_, k) => k !== i))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-white hover:bg-gray-900"
                    aria-label="Remove photo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {attaching && (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />

          <div className="flex items-end gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || attachments.length >= 4}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-indigo-600 disabled:opacity-50"
              aria-label="Attach a photo"
              title="Attach a photo"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
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
              placeholder="Ask the assistant, or attach a photo…"
              className="max-h-32 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              onClick={() => void send()}
              disabled={loading || (!input.trim() && attachments.length === 0)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-gray-400">
            Attach a photo (a quote, a parts list, a sketch) and tell me what to add. I act within your Trimpro permissions and won’t send anything to a customer without your confirmation.
          </p>
        </div>
      </div>
    </div>
  )
}
