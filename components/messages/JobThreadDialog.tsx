'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type ThreadMessage = {
  id: string
  text: string | null
  createdAt: string
  senderId: string
  sender: { id: string; firstName: string | null; lastName: string | null; email: string } | null
}

function senderName(sender: ThreadMessage['sender']) {
  if (!sender) return 'Unknown'
  return `${sender.firstName || ''} ${sender.lastName || ''}`.trim() || sender.email
}

function msgTimeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function JobThreadDialog({
  open,
  onOpenChange,
  jobId,
  jobNumber,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  jobNumber?: string
}) {
  const router = useRouter()
  const [myId, setMyId] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('accessToken') || ''
    const parts = token.split('.')
    if (parts.length >= 2) {
      try {
        const p = JSON.parse(atob(parts[1]))
        if (p?.userId) setMyId(String(p.userId))
      } catch {
        // ignore malformed token
      }
    }
  }, [])

  const authedFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        throw new Error('unauthenticated')
      }
      return fetch(url, {
        ...init,
        headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
      })
    },
    [router]
  )

  const loadMessages = useCallback(
    async (id: string) => {
      const res = await authedFetch(`/api/messages/conversations/${id}/messages?limit=100`)
      if (!res.ok) return
      const data = await res.json()
      setMessages((data.messages || []).slice().reverse())
      authedFetch(`/api/messages/conversations/${id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => {})
    },
    [authedFetch]
  )

  useEffect(() => {
    if (!open || !jobId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await authedFetch('/api/messages/job/ensure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) setError(data.error || 'Failed to open job chat')
          return
        }
        if (cancelled) return
        setConversationId(data.conversationId)
        await loadMessages(data.conversationId)
      } catch {
        if (!cancelled) setError('Failed to open job chat')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, jobId, authedFetch, loadMessages])

  useEffect(() => {
    if (!open) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  // Light polling while open so participants see new messages without a full chat client.
  useEffect(() => {
    if (!open || !conversationId) return
    const interval = setInterval(() => {
      loadMessages(conversationId)
    }, 8000)
    return () => clearInterval(interval)
  }, [open, conversationId, loadMessages])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || !conversationId || sending) return
    setSending(true)
    try {
      const res = await authedFetch(`/api/messages/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          clientTempId: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to send message')
        return
      }
      setText('')
      await loadMessages(conversationId)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Job Chat{jobNumber ? ` · ${jobNumber}` : ''}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col h-[420px] border rounded-md bg-gray-50">
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <p className="text-sm text-gray-400 text-center mt-8">Loading conversation...</p>
            ) : error ? (
              <p className="text-sm text-red-600 text-center mt-8">{error}</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-gray-400 text-center mt-8">No messages yet. Say hello!</p>
            ) : (
              messages.map((msg) => {
                const isMine = String(msg.senderId) === String(myId)
                return (
                  <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                      {!isMine && (
                        <span className="text-[11px] font-semibold text-indigo-500 mb-0.5 ml-1">
                          {senderName(msg.sender)}
                        </span>
                      )}
                      <div
                        className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                          isMine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white text-gray-900 rounded-bl-sm border'
                        }`}
                      >
                        {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
                        <div className={`mt-1 text-[10px] ${isMine ? 'text-blue-200' : 'text-gray-400'}`}>
                          {msgTimeStr(msg.createdAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t bg-white p-2 flex items-center gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Type a message..."
              rows={1}
              disabled={!conversationId || sending}
              className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 min-h-[36px] max-h-[80px]"
            />
            <Button size="sm" onClick={handleSend} disabled={!conversationId || sending || !text.trim()}>
              Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
