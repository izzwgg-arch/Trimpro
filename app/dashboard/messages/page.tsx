'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { refreshAccessToken } from '@/lib/auth/client'

type ConversationRow = {
  id: string
  type: 'TEAM' | 'DM' | 'JOB_THREAD'
  title: string
  pinned: boolean
  unreadCount: number
  lastMessageAt: string | null
  lastMessage: {
    id: string
    text: string | null
    type: string
    createdAt: string
    status: 'SENT' | 'DELIVERED' | 'READ'
    senderId: string
    jobId: string | null
    jobNumber: string | null
    jobName: string | null
  } | null
}

type ConversationMessage = {
  id: string
  senderId: string
  text: string | null
  type: 'TEXT' | 'MEDIA' | 'VOICE' | 'LOCATION' | 'SYSTEM'
  status: 'SENT' | 'DELIVERED' | 'READ'
  jobId: string | null
  jobNumber: string | null
  jobName: string | null
  createdAt: string
  sender: { id: string; firstName: string | null; lastName: string | null; email: string } | null
  attachments: Array<{
    id: string
    kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'LOCATION'
    url: string
    fileName: string | null
    mimeType: string | null
    durationMs: number | null
    thumbnailUrl: string | null
    latitude: number | null
    longitude: number | null
    sizeBytes: number | null
  }>
}

type UserRow = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
}

function fullName(user: { firstName: string | null; lastName: string | null; email: string } | null) {
  if (!user) return 'Unknown'
  const value = `${user.firstName || ''} ${user.lastName || ''}`.trim()
  return value || user.email
}

function messageStatusSymbol(status: string) {
  if (status === 'READ') return '✓✓'
  if (status === 'DELIVERED') return '✓✓'
  return '✓'
}

export default function MessagesPage() {
  const router = useRouter()
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [userFilter, setUserFilter] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [draftAttachments, setDraftAttachments] = useState<
    Array<{
      kind: 'IMAGE' | 'VIDEO' | 'FILE'
      url: string
      fileName: string
      mimeType: string
    }>
  >([])
  const [recording, setRecording] = useState(false)
  const [recordStartAt, setRecordStartAt] = useState<number | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaChunksRef = useRef<Blob[]>([])
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  )

  const fetchWithAuth = async (url: string, init?: RequestInit) => {
    let token = localStorage.getItem('accessToken')
    if (!token) {
      const refreshed = await refreshAccessToken()
      if (!refreshed) {
        router.push('/auth/login')
        throw new Error('Unauthorized')
      }
      token = localStorage.getItem('accessToken')
    }

    let response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    })

    if (response.status === 401) {
      const refreshed = await refreshAccessToken()
      if (!refreshed) {
        router.push('/auth/login')
        throw new Error('Unauthorized')
      }
      token = localStorage.getItem('accessToken')
      response = await fetch(url, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      })
    }
    return response
  }

  const loadConversations = async () => {
    const response = await fetchWithAuth('/api/messages/conversations')
    if (!response.ok) throw new Error('Failed to load conversations')
    const data = await response.json()
    const rows: ConversationRow[] = data.conversations || []
    setConversations(rows)
    if (!selectedConversationId && rows.length > 0) {
      setSelectedConversationId(rows[0].id)
    }
  }

  const loadUsers = async () => {
    const response = await fetchWithAuth('/api/messages/users')
    if (!response.ok) throw new Error('Failed to load users')
    const data = await response.json()
    setUsers(data.users || [])
  }

  const ensureTeam = async () => {
    await fetchWithAuth('/api/messages/team/ensure', { method: 'POST' })
  }

  const loadMessages = async (conversationId: string) => {
    const response = await fetchWithAuth(`/api/messages/conversations/${conversationId}/messages?limit=80`)
    if (!response.ok) throw new Error('Failed to load messages')
    const data = await response.json()
    setMessages((data.messages || []).reverse())
    await fetchWithAuth(`/api/messages/conversations/${conversationId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const next: Array<{ kind: 'IMAGE' | 'VIDEO' | 'FILE'; url: string; fileName: string; mimeType: string }> = []
    const maxFiles = Math.min(files.length, 8)
    for (let i = 0; i < maxFiles; i++) {
      const file = files[i]
      const formData = new FormData()
      formData.append('file', file)
      const uploadRes = await fetchWithAuth('/api/uploads/messages', {
        method: 'POST',
        body: formData,
      })
      if (!uploadRes.ok) continue
      const payload = await uploadRes.json()
      const kind = file.type.startsWith('image/')
        ? 'IMAGE'
        : file.type.startsWith('video/')
          ? 'VIDEO'
          : 'FILE'
      next.push({
        kind,
        url: payload.url,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
      })
    }
    setDraftAttachments((prev) => [...prev, ...next])
  }

  const sendLocation = async () => {
    if (!selectedConversationId || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await fetchWithAuth(`/api/messages/conversations/${selectedConversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'LOCATION',
            attachments: [
              {
                kind: 'LOCATION',
                url: `https://maps.google.com/?q=${position.coords.latitude},${position.coords.longitude}`,
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              },
            ],
          }),
        })
        await loadMessages(selectedConversationId)
        await loadConversations()
      },
      () => {}
    )
  }

  const startVoiceRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || recording) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream)
    mediaRecorderRef.current = recorder
    mediaChunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) mediaChunksRef.current.push(event.data)
    }
    recorder.start()
    setRecording(true)
    setRecordStartAt(Date.now())
  }

  const stopVoiceRecording = async () => {
    if (!mediaRecorderRef.current || !selectedConversationId || !recording) return
    const recorder = mediaRecorderRef.current
    const durationMs = recordStartAt ? Date.now() - recordStartAt : null

    await new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(mediaChunksRef.current, { type: 'audio/webm' })
          const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' })
          const formData = new FormData()
          formData.append('file', file)
          const uploadRes = await fetchWithAuth('/api/uploads/messages', {
            method: 'POST',
            body: formData,
          })
          if (uploadRes.ok) {
            const payload = await uploadRes.json()
            await fetchWithAuth(`/api/messages/conversations/${selectedConversationId}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'VOICE',
                attachments: [
                  {
                    kind: 'VOICE',
                    url: payload.url,
                    mimeType: 'audio/webm',
                    fileName: file.name,
                    durationMs,
                  },
                ],
              }),
            })
            await loadMessages(selectedConversationId)
            await loadConversations()
          }
        } finally {
          resolve()
        }
      }
      recorder.stop()
      recorder.stream.getTracks().forEach((track) => track.stop())
    })

    setRecording(false)
    setRecordStartAt(null)
    mediaRecorderRef.current = null
  }

  const sendMessage = async () => {
    if (!selectedConversationId || sending) return
    const trimmed = text.trim()
    if (!trimmed && draftAttachments.length === 0) return
    setSending(true)
    try {
      const clientTempId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const response = await fetchWithAuth(`/api/messages/conversations/${selectedConversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          clientTempId,
          attachments: draftAttachments.map((attachment) => ({
            kind: attachment.kind,
            url: attachment.url,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
          })),
        }),
      })
      if (!response.ok) throw new Error('Failed to send message')
      setText('')
      setDraftAttachments([])
      await loadMessages(selectedConversationId)
      await loadConversations()
    } finally {
      setSending(false)
    }
  }

  const createDm = async () => {
    if (!selectedUserId) return
    const response = await fetchWithAuth('/api/messages/dm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUserId }),
    })
    if (!response.ok) return
    const data = await response.json()
    await loadConversations()
    setSelectedConversationId(data.conversationId)
    setSelectedUserId('')
  }

  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (!token) return
    const parts = token.split('.')
    if (parts.length < 2) return
    try {
      const payload = JSON.parse(atob(parts[1]))
      if (payload?.userId) setCurrentUserId(String(payload.userId))
    } catch {
      // ignore parse failures
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        await ensureTeam()
        await Promise.all([loadConversations(), loadUsers()])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!selectedConversationId) return
    loadMessages(selectedConversationId)
  }, [selectedConversationId])

  useEffect(() => {
    if (!selectedConversationId) return
    const token = localStorage.getItem('accessToken')
    if (!token) return
    const source = new EventSource(
      `/api/messages/stream?token=${encodeURIComponent(token)}&since=${encodeURIComponent(new Date().toISOString())}`
    )
    source.addEventListener('new_message', async (event) => {
      const payload = JSON.parse((event as MessageEvent).data)
      if (payload.conversationId === selectedConversationId) {
        await loadMessages(selectedConversationId)
      }
      await loadConversations()
    })
    return () => source.close()
  }, [selectedConversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const filteredUsers = useMemo(() => {
    const q = userFilter.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => {
      const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase()
      return name.includes(q) || u.email.toLowerCase().includes(q)
    })
  }, [users, userFilter])

  if (loading) {
    return <div className="p-6 text-sm text-gray-600">Loading messages...</div>
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-[#0f1115] text-white">
      <aside className="w-[340px] border-r border-[#252a32] bg-[#13171d] flex flex-col">
        <div className="p-4 border-b border-[#252a32]">
          <h1 className="text-lg font-semibold">Messages</h1>
          <p className="text-xs text-gray-400 mt-1">Team Chat is always pinned at top.</p>
          <div className="mt-3 space-y-2">
            <input
              className="w-full h-9 px-3 rounded bg-[#0f1115] border border-[#303743] text-sm"
              placeholder="Search team member..."
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                className="flex-1 h-9 px-2 rounded bg-[#0f1115] border border-[#303743] text-sm"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                <option value="">Start direct message...</option>
                {filteredUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}
                  </option>
                ))}
              </select>
              <button className="h-9 px-3 rounded bg-[#2f6fed]" onClick={createDm}>
                New
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-auto flex-1">
          {conversations.map((conversation) => {
            const time = conversation.lastMessageAt
              ? (() => {
                  const date = new Date(conversation.lastMessageAt)
                  const now = new Date()
                  const diffMs = now.getTime() - date.getTime()
                  const diffMins = Math.floor(diffMs / 60000)
                  const diffHours = Math.floor(diffMs / 3600000)
                  const diffDays = Math.floor(diffMs / 86400000)
                  if (diffMins < 1) return 'Just now'
                  if (diffMins < 60) return `${diffMins}m`
                  if (diffHours < 24) return `${diffHours}h`
                  if (diffDays < 7) return `${diffDays}d`
                  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                })()
              : null
            return (
              <button
                key={conversation.id}
                onClick={() => setSelectedConversationId(conversation.id)}
                className={`w-full text-left px-4 py-3 border-b border-[#252a32] transition-colors ${
                  selectedConversationId === conversation.id ? 'bg-[#1b2028]' : 'hover:bg-[#181d24]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#2f6fed]/20 flex items-center justify-center flex-shrink-0">
                    {conversation.pinned ? (
                      <span className="text-[#2f6fed]">👥</span>
                    ) : (
                      <span className="text-[#2f6fed] text-sm font-semibold">
                        {conversation.title.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-medium text-sm truncate">
                        {conversation.pinned ? 'Team Chat' : conversation.title}
                      </div>
                      {time && <span className="text-xs text-gray-500 flex-shrink-0">{time}</span>}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-gray-400 truncate">
                        {conversation.lastMessage?.text || (conversation.lastMessage ? `[${conversation.lastMessage.type}]` : 'No messages yet')}
                      </div>
                      {conversation.unreadCount > 0 && (
                        <span className="min-w-5 h-5 px-2 rounded-full text-xs bg-[#2f6fed] flex items-center justify-center flex-shrink-0">
                          {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="flex-1 flex flex-col">
        {selectedConversation ? (
          <>
            <header className="h-14 px-5 border-b border-[#252a32] bg-[#13171d] flex items-center justify-between">
              <div>
                <div className="font-semibold">{selectedConversation.title}</div>
                <div className="text-xs text-gray-400">{selectedConversation.type === 'TEAM' ? 'Team Chat' : 'Direct Message'}</div>
              </div>
            </header>

            <div className="flex-1 overflow-auto px-5 py-4 space-y-3 bg-[#0f1115]">
              {messages.map((message, index) => {
                const mine = message.senderId === currentUserId
                const prevMessage = index > 0 ? messages[index - 1] : null
                const showDateSeparator =
                  !prevMessage ||
                  new Date(message.createdAt).toDateString() !== new Date(prevMessage.createdAt).toDateString()
                return (
                  <React.Fragment key={message.id}>
                    {showDateSeparator && (
                      <div className="flex items-center gap-3 my-4">
                        <div className="flex-1 h-px bg-[#252a32]" />
                        <span className="text-xs text-gray-500">
                          {(() => {
                            const date = new Date(message.createdAt)
                            const today = new Date()
                            const yesterday = new Date(today)
                            yesterday.setDate(yesterday.getDate() - 1)
                            if (date.toDateString() === today.toDateString()) return 'Today'
                            if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
                            return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
                          })()}
                        </span>
                        <div className="flex-1 h-px bg-[#252a32]" />
                      </div>
                    )}
                    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-[#2f6fed]' : 'bg-[#232a33]'}`}>
                        {selectedConversation.type === 'TEAM' && !mine && (
                          <div className="text-[11px] text-[#9ec6ff] mb-1.5 font-semibold">{fullName(message.sender)}</div>
                        )}
                        {message.jobId && (
                          <a
                            href={`/dashboard/jobs/${message.jobId}`}
                            className="block mb-2 p-2 rounded-lg bg-black/20 hover:bg-black/30 transition-colors text-xs border border-white/10"
                          >
                            <span className="font-semibold">📋 Job #{message.jobNumber || 'N/A'}</span>
                            <span className="block mt-0.5 text-gray-300">{message.jobName || 'View job'}</span>
                          </a>
                        )}
                        {message.text && <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.text}</div>}
                        {message.attachments.map((attachment) => (
                          <div key={attachment.id} className="mt-2">
                            {attachment.kind === 'IMAGE' && (
                              <a href={attachment.url} target="_blank" rel="noreferrer" className="block">
                                <img src={attachment.url} alt={attachment.fileName || 'Image'} className="rounded-lg max-h-[260px] cursor-pointer hover:opacity-90 transition-opacity" />
                              </a>
                            )}
                            {attachment.kind === 'VIDEO' && (
                              <video controls className="rounded-lg max-h-[260px]" src={attachment.url} />
                            )}
                            {attachment.kind === 'VOICE' && (
                              <div className="flex items-center gap-2 p-2 rounded-lg bg-black/20">
                                <audio controls src={attachment.url} className="flex-1" />
                                {attachment.durationMs && (
                                  <span className="text-xs text-gray-400">{Math.round(attachment.durationMs / 1000)}s</span>
                                )}
                              </div>
                            )}
                            {attachment.kind === 'FILE' && (
                              <a
                                href={attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 p-2 rounded-lg bg-black/20 hover:bg-black/30 transition-colors"
                              >
                                <span className="text-lg">📄</span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium truncate">{attachment.fileName || 'Download file'}</div>
                                  {attachment.sizeBytes && (
                                    <div className="text-xs text-gray-400">{(attachment.sizeBytes / 1024).toFixed(1)} KB</div>
                                  )}
                                </div>
                              </a>
                            )}
                            {attachment.kind === 'LOCATION' && (
                              <a
                                href={`https://maps.google.com/?q=${attachment.latitude},${attachment.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 p-2 rounded-lg bg-black/20 hover:bg-black/30 transition-colors"
                              >
                                <span className="text-lg">📍</span>
                                <div>
                                  <div className="text-sm font-medium">Open in Maps</div>
                                  {attachment.latitude && attachment.longitude && (
                                    <div className="text-xs text-gray-400">
                                      {attachment.latitude.toFixed(4)}, {attachment.longitude.toFixed(4)}
                                    </div>
                                  )}
                                </div>
                              </a>
                            )}
                          </div>
                        ))}
                        <div className="mt-1.5 text-[11px] text-gray-300 flex justify-end gap-2 items-center">
                          <span>{new Date(message.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                          {mine && <span className="opacity-80">{messageStatusSymbol(message.status)}</span>}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}
              <div ref={bottomRef} />
            </div>

            <footer className="border-t border-[#252a32] bg-[#13171d] p-3">
              {draftAttachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {draftAttachments.map((attachment) => (
                    <div key={attachment.url} className="text-xs px-2 py-1 rounded bg-[#232a33]">
                      {attachment.fileName}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <input type="file" multiple className="hidden" id="msg-upload-input" onChange={(e) => uploadFiles(e.target.files)} />
                <button
                  type="button"
                  className="h-10 w-10 rounded bg-[#232a33]"
                  onClick={() => document.getElementById('msg-upload-input')?.click()}
                >
                  +
                </button>
                <button type="button" className="h-10 px-3 rounded bg-[#232a33] text-xs" onClick={sendLocation}>
                  Location
                </button>
                <button
                  type="button"
                  className={`h-10 px-3 rounded text-xs ${recording ? 'bg-red-600' : 'bg-[#232a33]'}`}
                  onMouseDown={startVoiceRecording}
                  onMouseUp={stopVoiceRecording}
                  onMouseLeave={() => recording && stopVoiceRecording()}
                  onTouchStart={startVoiceRecording}
                  onTouchEnd={stopVoiceRecording}
                >
                  {recording ? 'Recording...' : 'Hold mic'}
                </button>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  rows={2}
                  className="flex-1 min-h-10 max-h-36 rounded bg-[#0f1115] border border-[#303743] px-3 py-2 text-sm"
                  placeholder="Type a message..."
                />
                <button className="h-10 px-4 rounded bg-[#2f6fed] disabled:opacity-60" onClick={sendMessage} disabled={sending}>
                  Send
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">Select a conversation</div>
        )}
      </section>
    </div>
  )
}
