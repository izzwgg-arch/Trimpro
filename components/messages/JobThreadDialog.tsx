'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { refreshAccessToken } from '@/lib/auth/client'
import {
  Composer,
  MsgBubble,
  dateSep,
  normaliseTeamMsg,
  replyPreviewText,
  type DraftMedia,
  type NormalizedMsg,
  type ReactionEntry,
} from '@/components/messages/chat-ui'

type Recipient = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  role: string
  isAssignee: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  jobNumber?: string | null
}

function recipientLabel(r: Recipient) {
  return `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.email
}

/**
 * Full job chat popup: same reply / reactions / attachments / voice as Messages,
 * plus a recipient picker for who to notify on send.
 */
export function JobThreadDialog({ open, onOpenChange, jobId, jobNumber }: Props) {
  const router = useRouter()
  const [myId, setMyId] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<NormalizedMsg[]>([])
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [msgsLoading, setMsgsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replyTarget, setReplyTarget] = useState<NormalizedMsg | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAuth = useCallback(async (url: string, init?: RequestInit) => {
    let token = localStorage.getItem('accessToken')
    if (!token) {
      if (!(await refreshAccessToken())) {
        router.push('/auth/login')
        throw new Error('unauthenticated')
      }
      token = localStorage.getItem('accessToken')
    }
    const withAuth = (authToken: string | null): RequestInit => ({
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    })
    let res = await fetch(url, withAuth(token))
    if (res.status === 401) {
      if (!(await refreshAccessToken())) {
        router.push('/auth/login')
        throw new Error('unauthenticated')
      }
      token = localStorage.getItem('accessToken')
      res = await fetch(url, withAuth(token))
    }
    return res
  }, [router])

  useEffect(() => {
    const token = localStorage.getItem('accessToken') || ''
    const parts = token.split('.')
    if (parts.length >= 2) {
      try {
        const p = JSON.parse(atob(parts[1]))
        if (p?.userId) setMyId(String(p.userId))
      } catch {
        /* ignore */
      }
    }
  }, [])

  const loadMessages = useCallback(
    async (id: string, uid: string) => {
      setMsgsLoading(true)
      try {
        const res = await fetchAuth(`/api/messages/conversations/${id}/messages?limit=80`)
        if (!res.ok) return
        const data = await res.json()
        const rawMsgs: any[] = (data.messages || []).reverse()
        setMessages(rawMsgs.map((m) => normaliseTeamMsg(m, uid)))
        fetchAuth(`/api/messages/conversations/${id}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).catch(() => {})
      } finally {
        setMsgsLoading(false)
      }
    },
    [fetchAuth]
  )

  useEffect(() => {
    if (!open || !jobId || !myId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchAuth('/api/messages/job/ensure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError(typeof data?.error === 'string' ? data.error : 'Failed to open job chat')
          return
        }
        const id = data.conversationId as string
        const list: Recipient[] = Array.isArray(data.recipients) ? data.recipients : []
        setConversationId(id)
        setRecipients(list)
        setSelectedRecipientIds(list.map((r) => r.id).filter((rid) => rid !== myId))
        if (id) await loadMessages(id, myId)
      } catch {
        if (!cancelled) setError('Failed to open job chat')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, jobId, myId, fetchAuth, loadMessages])

  useEffect(() => {
    if (!open) {
      setConversationId(null)
      setMessages([])
      setReplyTarget(null)
      setError(null)
      setPickerOpen(false)
    }
  }, [open])

  useEffect(() => {
    if (!open || !conversationId || !myId) return
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => {
      loadMessages(conversationId, myId)
    }, 5000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [open, conversationId, myId, loadMessages])

  useEffect(() => {
    if (!open) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  const selectedCount = selectedRecipientIds.length
  const selectedSummary = useMemo(() => {
    if (selectedCount === 0) return 'No recipients'
    if (selectedCount === recipients.filter((r) => r.id !== myId).length) return 'Everyone'
    if (selectedCount <= 2) {
      return recipients
        .filter((r) => selectedRecipientIds.includes(r.id))
        .map(recipientLabel)
        .join(', ')
    }
    return `${selectedCount} people`
  }, [selectedCount, recipients, selectedRecipientIds, myId])

  const toggleRecipient = (id: string) => {
    setSelectedRecipientIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const selectAllRecipients = () => {
    setSelectedRecipientIds(recipients.map((r) => r.id).filter((id) => id !== myId))
  }

  const clearRecipients = () => setSelectedRecipientIds([])

  const handleReply = useCallback((msg: NormalizedMsg) => {
    if (!msg.canInteract) return
    setReplyTarget(msg)
  }, [])

  const jumpToMessage = useCallback((messageId: string) => {
    setHighlightedId(messageId)
    const el = document.getElementById(`msg-${messageId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => setHighlightedId((cur) => (cur === messageId ? null : cur)), 1600)
  }, [])

  const handleToggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!conversationId) return
      try {
        const res = await fetchAuth(
          `/api/messages/conversations/${conversationId}/messages/${messageId}/react`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji }),
          }
        )
        if (!res.ok) return
        const data = await res.json()
        const reactions: ReactionEntry[] = data.reactions || []
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)))
      } catch {
        /* best-effort */
      }
    },
    [conversationId, fetchAuth]
  )

  const handleSend = useCallback(
    async (text: string, media: DraftMedia[], durationMs?: number) => {
      if (!conversationId) return
      if (selectedRecipientIds.length === 0) {
        alert('Select at least one person to send to')
        return
      }

      const attachments = media.map((m) => {
        const kind =
          m.type === 'image' ? 'IMAGE'
          : m.type === 'video' ? 'VIDEO'
          : m.type === 'audio' ? 'VOICE'
          : 'FILE'
        return {
          kind,
          url: m.url,
          fileName: m.filename,
          mimeType: m.mimeType,
          durationMs: kind === 'VOICE' ? durationMs || null : null,
        }
      })

      const res = await fetchAuth(`/api/messages/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text || null,
          clientTempId: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          jobId,
          notifyUserIds: selectedRecipientIds,
          replyToMessageId: replyTarget?.id || null,
          replyToSenderName: replyTarget
            ? replyTarget.isMine
              ? 'You'
              : replyTarget.senderName || 'Unknown'
            : null,
          replyToText: replyTarget ? replyPreviewText(replyTarget) : null,
          replyToType: replyTarget
            ? replyTarget.attachments.length === 0
              ? 'TEXT'
              : replyTarget.attachments[0].kind === 'AUDIO'
                ? 'VOICE'
                : replyTarget.attachments[0].kind === 'LOCATION'
                  ? 'LOCATION'
                  : replyTarget.attachments[0].kind
            : null,
          attachments,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || 'Failed to send')
        return
      }
      setReplyTarget(null)
      await loadMessages(conversationId, myId)
    },
    [
      conversationId,
      fetchAuth,
      jobId,
      loadMessages,
      myId,
      replyTarget,
      selectedRecipientIds,
    ]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden flex flex-col max-h-[min(90vh,820px)]">
        <DialogHeader className="px-4 pt-4 pb-2 border-b space-y-2">
          <DialogTitle>{jobNumber ? `Job Chat · ${jobNumber}` : 'Job Chat'}</DialogTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Assigned crew &amp; office · reply, reactions, attachments &amp; voice
          </p>

          {/* Recipient picker */}
          <div className="relative pt-1">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="w-full flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-left text-sm hover:bg-muted/70 transition-colors"
            >
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To</span>
              <span className="flex-1 truncate font-medium text-foreground">{selectedSummary}</span>
              <svg
                className={`w-4 h-4 text-muted-foreground transition-transform ${pickerOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {pickerOpen && (
              <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border bg-white shadow-lg max-h-56 overflow-y-auto">
                <div className="sticky top-0 flex items-center gap-2 px-3 py-2 bg-white border-b text-xs">
                  <button type="button" className="text-blue-600 hover:underline" onClick={selectAllRecipients}>
                    Select all
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button type="button" className="text-blue-600 hover:underline" onClick={clearRecipients}>
                    Clear
                  </button>
                </div>
                {recipients.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">No recipients available</p>
                ) : (
                  recipients
                    .filter((r) => r.id !== myId)
                    .map((r) => {
                      const checked = selectedRecipientIds.includes(r.id)
                      return (
                        <label
                          key={r.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRecipient(r.id)}
                            className="rounded border-gray-300"
                          />
                          <span className="flex-1 min-w-0">
                            <span className="font-medium block truncate">{recipientLabel(r)}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {r.isAssignee ? 'Assignee' : r.role}
                            </span>
                          </span>
                        </label>
                      )
                    })
                )}
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-[320px] overflow-y-auto bg-gray-50 px-3 py-3 space-y-1">
          {loading && !conversationId ? (
            <p className="text-sm text-muted-foreground text-center mt-10">Opening chat…</p>
          ) : error ? (
            <div className="text-center mt-10 space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setError(null)
                  setLoading(true)
                  void (async () => {
                    try {
                      const res = await fetchAuth('/api/messages/job/ensure', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jobId }),
                      })
                      const data = await res.json().catch(() => ({}))
                      if (!res.ok) {
                        setError(typeof data?.error === 'string' ? data.error : 'Failed to open job chat')
                        return
                      }
                      const id = data.conversationId as string
                      const list: Recipient[] = Array.isArray(data.recipients) ? data.recipients : []
                      setConversationId(id)
                      setRecipients(list)
                      setSelectedRecipientIds(list.map((r) => r.id).filter((rid) => rid !== myId))
                      if (id) await loadMessages(id, myId)
                    } catch {
                      setError('Failed to open job chat')
                    } finally {
                      setLoading(false)
                    }
                  })()
                }}
              >
                Try again
              </Button>
            </div>
          ) : msgsLoading && messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center mt-10">Loading messages…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center mt-10">No messages yet. Say hello!</p>
          ) : (
            messages.map((msg, i) => {
              const prev = i > 0 ? messages[i - 1] : null
              const showDate =
                !prev || new Date(msg.createdAt).toDateString() !== new Date(prev.createdAt).toDateString()
              const next = i < messages.length - 1 ? messages[i + 1] : null
              const isLastInGroup = !next || next.isMine !== msg.isMine
              const showName = !msg.isMine && (!prev || prev.isMine !== msg.isMine)

              return (
                <div key={msg.id} className={isLastInGroup ? 'mb-2' : 'mb-0.5'}>
                  {showDate && (
                    <div className="flex items-center gap-3 my-3">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-[11px] text-gray-400 font-medium px-2">
                        {dateSep(msg.createdAt)}
                      </span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>
                  )}
                  <MsgBubble
                    msg={msg}
                    showSenderName={showName}
                    myId={myId}
                    isHighlighted={highlightedId === msg.id}
                    onReply={handleReply}
                    onToggleReaction={handleToggleReaction}
                    onJumpTo={jumpToMessage}
                  />
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>

        <Composer
          isSms={false}
          disabled={!conversationId || selectedRecipientIds.length === 0}
          onSend={handleSend}
          replyPreview={
            replyTarget
              ? {
                  senderName: replyTarget.isMine ? 'You' : replyTarget.senderName || 'Unknown',
                  textPreview: replyPreviewText(replyTarget),
                }
              : null
          }
          onClearReply={() => setReplyTarget(null)}
        />
      </DialogContent>
    </Dialog>
  )
}
