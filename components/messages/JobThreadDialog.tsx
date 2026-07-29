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

type JobThread = {
  id: string
  title: string | null
  lastMessageAt: string | null
  createdAt: string
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

function threadLabel(t: JobThread) {
  const title = (t.title || '').trim()
  if (title) return title
  return 'General'
}

/**
 * Full job chat popup: threads, recipients, reply / reactions / attachments / voice / delete.
 */
export function JobThreadDialog({ open, onOpenChange, jobId, jobNumber }: Props) {
  const router = useRouter()
  const [myId, setMyId] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [threads, setThreads] = useState<JobThread[]>([])
  const [messages, setMessages] = useState<NormalizedMsg[]>([])
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [msgsLoading, setMsgsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replyTarget, setReplyTarget] = useState<NormalizedMsg | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  const [newThreadTitle, setNewThreadTitle] = useState('')
  const [creatingThread, setCreatingThread] = useState(false)
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

  const applyEnsurePayload = useCallback(
    async (data: any, uid: string) => {
      const id = data.conversationId as string
      const list: Recipient[] = Array.isArray(data.recipients) ? data.recipients : []
      const threadList: JobThread[] = Array.isArray(data.threads) ? data.threads : []
      setConversationId(id)
      setRecipients(list)
      setThreads(threadList)
      setSelectedRecipientIds((prev) => {
        if (prev.length > 0) {
          const allowed = new Set(list.map((r) => r.id))
          const kept = prev.filter((rid) => allowed.has(rid) && rid !== uid)
          if (kept.length > 0) return kept
        }
        return list.map((r) => r.id).filter((rid) => rid !== uid)
      })
      if (id) await loadMessages(id, uid)
    },
    [loadMessages]
  )

  const ensureThread = useCallback(
    async (opts?: { title?: string; conversationId?: string }) => {
      const res = await fetchAuth('/api/messages/job/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          title: opts?.title,
          conversationId: opts?.conversationId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to open job chat')
      }
      return data
    },
    [fetchAuth, jobId]
  )

  useEffect(() => {
    if (!open || !jobId || !myId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await ensureThread()
        if (cancelled) return
        await applyEnsurePayload(data, myId)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to open job chat')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, jobId, myId, ensureThread, applyEnsurePayload])

  useEffect(() => {
    if (!open) {
      setConversationId(null)
      setMessages([])
      setThreads([])
      setReplyTarget(null)
      setError(null)
      setPickerOpen(false)
      setNewThreadOpen(false)
      setNewThreadTitle('')
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

  const activeThread = useMemo(
    () => threads.find((t) => t.id === conversationId) || null,
    [threads, conversationId]
  )

  const selectedCount = selectedRecipientIds.length
  const selectedSummary = useMemo(() => {
    const others = recipients.filter((r) => r.id !== myId)
    if (selectedCount === 0) return 'No recipients'
    if (others.length > 0 && selectedCount === others.length) return 'Everyone'
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

  const switchThread = async (threadId: string) => {
    if (threadId === conversationId) return
    setLoading(true)
    setError(null)
    setReplyTarget(null)
    try {
      const data = await ensureThread({ conversationId: threadId })
      await applyEnsurePayload(data, myId)
    } catch (e: any) {
      setError(e?.message || 'Failed to switch thread')
    } finally {
      setLoading(false)
    }
  }

  const createThread = async () => {
    const title = newThreadTitle.trim()
    if (!title || creatingThread) return
    setCreatingThread(true)
    setError(null)
    try {
      const data = await ensureThread({ title })
      await applyEnsurePayload(data, myId)
      setNewThreadOpen(false)
      setNewThreadTitle('')
    } catch (e: any) {
      setError(e?.message || 'Failed to create thread')
    } finally {
      setCreatingThread(false)
    }
  }

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

  const handleDelete = useCallback(
    async (msg: NormalizedMsg) => {
      if (!conversationId || !msg.isMine) return
      if (!window.confirm('Delete this message for everyone?')) return
      try {
        const res = await fetchAuth(
          `/api/messages/conversations/${conversationId}/messages/${msg.id}`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'EVERYONE' }),
          }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          alert(data.error || 'Failed to delete message')
          return
        }
        setMessages((prev) => prev.filter((m) => m.id !== msg.id))
        if (replyTarget?.id === msg.id) setReplyTarget(null)
      } catch {
        alert('Failed to delete message')
      }
    },
    [conversationId, fetchAuth, replyTarget]
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
    [conversationId, fetchAuth, loadMessages, myId, replyTarget, selectedRecipientIds]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl w-[min(96vw,920px)] p-0 gap-0 overflow-hidden flex flex-col h-[min(92vh,880px)] max-h-[92vh]">
        <DialogHeader className="px-5 pt-5 pb-3 border-b space-y-3">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div>
              <DialogTitle>{jobNumber ? `Job chat · ${jobNumber}` : 'Job chat'}</DialogTitle>
              <p className="text-xs text-muted-foreground font-normal mt-1">
                Multiple threads · pick who to notify · reply, reactions, attachments &amp; voice
              </p>
            </div>
          </div>

          {/* Thread switcher */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto pb-0.5">
              {threads.map((t) => {
                const active = t.id === conversationId
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void switchThread(t.id)}
                    className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold border transition-colors ${
                      active
                        ? 'bg-amber-100 border-amber-400 text-amber-950 shadow-sm'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-amber-300 hover:bg-amber-50/50'
                    }`}
                  >
                    {threadLabel(t)}
                  </button>
                )
              })}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => setNewThreadOpen((v) => !v)}
            >
              + New thread
            </Button>
          </div>

          {newThreadOpen && (
            <div className="flex items-center gap-2">
              <input
                value={newThreadTitle}
                onChange={(e) => setNewThreadTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void createThread()
                  }
                }}
                placeholder="Thread name (e.g. Materials, Punch list)"
                className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <Button
                type="button"
                size="sm"
                disabled={!newThreadTitle.trim() || creatingThread}
                onClick={() => void createThread()}
              >
                Create
              </Button>
            </div>
          )}

          {activeThread && (
            <p className="text-[11px] text-muted-foreground">
              Active thread: <span className="font-medium text-foreground">{threadLabel(activeThread)}</span>
            </p>
          )}

          {/* Recipient picker */}
          <div className="relative">
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

        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 py-3 space-y-1">
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
                  void ensureThread()
                    .then((data) => applyEnsurePayload(data, myId))
                    .catch((e: any) => setError(e?.message || 'Failed to open job chat'))
                    .finally(() => setLoading(false))
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
                    showJobLink={false}
                    myId={myId}
                    isHighlighted={highlightedId === msg.id}
                    onReply={handleReply}
                    onToggleReaction={handleToggleReaction}
                    onJumpTo={jumpToMessage}
                    onDelete={handleDelete}
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
