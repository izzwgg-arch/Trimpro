'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { refreshAccessToken } from '@/lib/auth/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'team' | 'sms'

type ConversationRow = {
  id: string
  type: 'TEAM' | 'DM' | 'JOB_THREAD'
  title: string
  pinned: boolean
  unreadCount: number
  lastMessageAt: string | null
  lastMessage: {
    id: string; text: string | null; type: string; createdAt: string
    status: 'SENT' | 'DELIVERED' | 'READ'; senderId: string
    jobId: string | null; jobNumber: string | null; jobName: string | null
  } | null
}

type ChatMessage = {
  id: string; senderId: string; text: string | null
  type: 'TEXT' | 'MEDIA' | 'VOICE' | 'LOCATION' | 'SYSTEM'
  status: 'SENT' | 'DELIVERED' | 'READ'
  jobId: string | null; jobNumber: string | null; jobName: string | null
  createdAt: string
  sender: { id: string; firstName: string | null; lastName: string | null; email: string } | null
  attachments: Array<{
    id: string; kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'LOCATION'
    url: string; fileName: string | null; mimeType: string | null
    durationMs: number | null; thumbnailUrl: string | null
    latitude: number | null; longitude: number | null; sizeBytes: number | null
  }>
}

type SmsConversation = {
  id: string; phone: string; phoneDisplay: string
  clientName: string | null; channel: string
  unreadCount: number; lastMessageAt: string | null
  lastMessage: { body: string | null; direction: string; createdAt: string } | null
}

type SmsMessage = {
  id: string; direction: 'INBOUND' | 'OUTBOUND'
  body: string | null; createdAt: string; status: string
  fromNumber: string | null; toNumber: string | null
  media: Array<{ id: string; type: string; url: string; mimeType: string | null }>
}

type UserRow = { id: string; firstName: string | null; lastName: string | null; email: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fullName(u: { firstName: string | null; lastName: string | null; email: string } | null) {
  if (!u) return 'Unknown'
  return `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email
}

function relativeTime(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const mins = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dateSeparatorLabel(iso: string) {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ label, color = 'blue' }: { label: string; color?: 'blue' | 'green' | 'purple' }) {
  const bg = color === 'green' ? 'bg-emerald-100 text-emerald-700'
    : color === 'purple' ? 'bg-purple-100 text-purple-700'
    : 'bg-blue-100 text-blue-700'
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold ${bg}`}>
      {label.charAt(0).toUpperCase()}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MessagesPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('team')
  const [currentUserId, setCurrentUserId] = useState('')

  // ── Team chat state ──────────────────────────────────────────────────────
  const [teamConversations, setTeamConversations] = useState<ConversationRow[]>([])
  const [teamMessages, setTeamMessages] = useState<ChatMessage[]>([])
  const [teamLoading, setTeamLoading] = useState(true)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [userFilter, setUserFilter] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [teamText, setTeamText] = useState('')
  const [teamSending, setTeamSending] = useState(false)
  const [teamDraftAttachments, setTeamDraftAttachments] = useState<
    Array<{ kind: 'IMAGE' | 'VIDEO' | 'FILE'; url: string; fileName: string; mimeType: string }>
  >([])
  const [teamRecording, setTeamRecording] = useState(false)
  const [teamRecordStart, setTeamRecordStart] = useState<number | null>(null)
  const teamRecorderRef = useRef<MediaRecorder | null>(null)
  const teamChunksRef = useRef<Blob[]>([])

  // ── SMS state ────────────────────────────────────────────────────────────
  const [smsConversations, setSmsConversations] = useState<SmsConversation[]>([])
  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>([])
  const [smsLoading, setSmsLoading] = useState(false)
  const [selectedSmsId, setSelectedSmsId] = useState<string | null>(null)
  const [smsText, setSmsText] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const [newSmsPhone, setNewSmsPhone] = useState('')
  const [showNewSms, setShowNewSms] = useState(false)

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const smsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Auth helper ──────────────────────────────────────────────────────────
  const fetchWithAuth = useCallback(async (url: string, init?: RequestInit) => {
    let token = localStorage.getItem('accessToken')
    if (!token) {
      if (!await refreshAccessToken()) { router.push('/auth/login'); throw new Error('Unauthorized') }
      token = localStorage.getItem('accessToken')
    }
    let res = await fetch(url, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` } })
    if (res.status === 401) {
      if (!await refreshAccessToken()) { router.push('/auth/login'); throw new Error('Unauthorized') }
      token = localStorage.getItem('accessToken')
      res = await fetch(url, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` } })
    }
    return res
  }, [router])

  // ── Team chat loaders ────────────────────────────────────────────────────
  const loadTeamConversations = useCallback(async () => {
    const res = await fetchWithAuth('/api/messages/conversations')
    if (!res.ok) return
    const data = await res.json()
    const rows: ConversationRow[] = data.conversations || []
    setTeamConversations(rows)
    if (!selectedTeamId && rows.length > 0) setSelectedTeamId(rows[0].id)
  }, [fetchWithAuth, selectedTeamId])

  const loadUsers = useCallback(async () => {
    const res = await fetchWithAuth('/api/messages/users')
    if (!res.ok) return
    const data = await res.json()
    setUsers(data.users || [])
  }, [fetchWithAuth])

  const loadTeamMessages = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`/api/messages/conversations/${id}/messages?limit=80`)
    if (!res.ok) return
    const data = await res.json()
    setTeamMessages((data.messages || []).reverse())
    await fetchWithAuth(`/api/messages/conversations/${id}/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    }).catch(() => {})
  }, [fetchWithAuth])

  // ── SMS loaders ──────────────────────────────────────────────────────────
  const loadSmsConversations = useCallback(async () => {
    const res = await fetchWithAuth('/api/sms/conversations')
    if (!res.ok) return
    const data = await res.json()
    setSmsConversations(data.conversations || [])
  }, [fetchWithAuth])

  const loadSmsMessages = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`/api/sms/conversations/${id}/messages`)
    if (!res.ok) return
    const data = await res.json()
    setSmsMessages(data.messages || [])
  }, [fetchWithAuth])

  // ── Bootstrap ────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('accessToken') || ''
    const parts = token.split('.')
    if (parts.length >= 2) {
      try { const p = JSON.parse(atob(parts[1])); if (p?.userId) setCurrentUserId(String(p.userId)) } catch {}
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      setTeamLoading(true)
      try {
        await fetchWithAuth('/api/messages/team/ensure', { method: 'POST' }).catch(() => {})
        await Promise.all([loadTeamConversations(), loadUsers()])
      } finally { setTeamLoading(false) }
    })()
  }, [])

  useEffect(() => {
    if (tab === 'sms') {
      setSmsLoading(true)
      loadSmsConversations().finally(() => setSmsLoading(false))
    }
  }, [tab])

  // ── Team SSE ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedTeamId) return
    loadTeamMessages(selectedTeamId)
  }, [selectedTeamId])

  useEffect(() => {
    if (!selectedTeamId) return
    const token = localStorage.getItem('accessToken')
    if (!token) return
    const source = new EventSource(`/api/messages/stream?token=${encodeURIComponent(token)}&since=${encodeURIComponent(new Date().toISOString())}`)
    source.addEventListener('new_message', async (event) => {
      const payload = JSON.parse((event as MessageEvent).data)
      if (payload.conversationId === selectedTeamId) await loadTeamMessages(selectedTeamId)
      await loadTeamConversations()
    })
    return () => source.close()
  }, [selectedTeamId])

  // ── SMS polling ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedSmsId) return
    loadSmsMessages(selectedSmsId)
    if (smsIntervalRef.current) clearInterval(smsIntervalRef.current)
    smsIntervalRef.current = setInterval(() => {
      loadSmsMessages(selectedSmsId)
      loadSmsConversations()
    }, 5000)
    return () => { if (smsIntervalRef.current) clearInterval(smsIntervalRef.current) }
  }, [selectedSmsId])

  // ── Scroll to bottom ──────────────────────────────────────────────────────
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [teamMessages, smsMessages])

  // ── Team actions ──────────────────────────────────────────────────────────
  const uploadFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    const next: typeof teamDraftAttachments = []
    for (let i = 0; i < Math.min(files.length, 8); i++) {
      const file = files[i]
      const fd = new FormData(); fd.append('file', file)
      const res = await fetchWithAuth('/api/uploads/messages', { method: 'POST', body: fd })
      if (!res.ok) continue
      const payload = await res.json()
      const kind = file.type.startsWith('image/') ? 'IMAGE' : file.type.startsWith('video/') ? 'VIDEO' : 'FILE'
      next.push({ kind, url: payload.url, fileName: file.name, mimeType: file.type || 'application/octet-stream' })
    }
    setTeamDraftAttachments((prev) => [...prev, ...next])
  }

  const sendTeamMessage = async () => {
    if (!selectedTeamId || teamSending) return
    const trimmed = teamText.trim()
    if (!trimmed && teamDraftAttachments.length === 0) return
    setTeamSending(true)
    try {
      const res = await fetchWithAuth(`/api/messages/conversations/${selectedTeamId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          clientTempId: `web-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          attachments: teamDraftAttachments.map((a) => ({ kind: a.kind, url: a.url, fileName: a.fileName, mimeType: a.mimeType })),
        }),
      })
      if (!res.ok) return
      setTeamText(''); setTeamDraftAttachments([])
      await loadTeamMessages(selectedTeamId)
      await loadTeamConversations()
    } finally { setTeamSending(false) }
  }

  const createDm = async () => {
    if (!selectedUserId) return
    const res = await fetchWithAuth('/api/messages/dm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUserId }),
    })
    if (!res.ok) return
    const data = await res.json()
    await loadTeamConversations()
    setSelectedTeamId(data.conversationId)
    setSelectedUserId('')
  }

  const startVoiceRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || teamRecording) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream)
    teamRecorderRef.current = recorder; teamChunksRef.current = []
    recorder.ondataavailable = (e) => { if (e.data.size > 0) teamChunksRef.current.push(e.data) }
    recorder.start(); setTeamRecording(true); setTeamRecordStart(Date.now())
  }

  const stopVoiceRecording = async () => {
    if (!teamRecorderRef.current || !selectedTeamId || !teamRecording) return
    const recorder = teamRecorderRef.current
    const durationMs = teamRecordStart ? Date.now() - teamRecordStart : null
    await new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(teamChunksRef.current, { type: 'audio/webm' })
          const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' })
          const fd = new FormData(); fd.append('file', file)
          const upRes = await fetchWithAuth('/api/uploads/messages', { method: 'POST', body: fd })
          if (upRes.ok) {
            const { url } = await upRes.json()
            await fetchWithAuth(`/api/messages/conversations/${selectedTeamId}/messages`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'VOICE', attachments: [{ kind: 'VOICE', url, mimeType: 'audio/webm', fileName: file.name, durationMs }] }),
            })
            await loadTeamMessages(selectedTeamId)
            await loadTeamConversations()
          }
        } finally { resolve() }
      }
      recorder.stop(); recorder.stream.getTracks().forEach((t) => t.stop())
    })
    setTeamRecording(false); setTeamRecordStart(null); teamRecorderRef.current = null
  }

  const sendLocation = async () => {
    if (!selectedTeamId || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(async (pos) => {
      await fetchWithAuth(`/api/messages/conversations/${selectedTeamId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'LOCATION', attachments: [{ kind: 'LOCATION', url: `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`, latitude: pos.coords.latitude, longitude: pos.coords.longitude }] }),
      })
      await loadTeamMessages(selectedTeamId)
    }, () => {})
  }

  // ── SMS actions ───────────────────────────────────────────────────────────
  const sendSmsMessage = async () => {
    if (!selectedSmsId || smsSending) return
    const trimmed = smsText.trim()
    if (!trimmed) return
    setSmsSending(true)
    try {
      const res = await fetchWithAuth(`/api/sms/conversations/${selectedSmsId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Failed to send SMS'); return }
      setSmsText('')
      await loadSmsMessages(selectedSmsId)
      await loadSmsConversations()
    } finally { setSmsSending(false) }
  }

  const startNewSmsConversation = async () => {
    const phone = newSmsPhone.trim()
    if (!phone) return
    const res = await fetchWithAuth('/api/sms/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
    if (!res.ok) { alert('Failed to start conversation'); return }
    const data = await res.json()
    await loadSmsConversations()
    setSelectedSmsId(data.conversationId)
    setNewSmsPhone(''); setShowNewSms(false)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedTeamConversation = useMemo(() => teamConversations.find((c) => c.id === selectedTeamId) || null, [teamConversations, selectedTeamId])
  const selectedSmsConversation = useMemo(() => smsConversations.find((c) => c.id === selectedSmsId) || null, [smsConversations, selectedSmsId])
  const filteredUsers = useMemo(() => {
    const q = userFilter.toLowerCase()
    if (!q) return users
    return users.filter((u) => `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, userFilter])

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] bg-white">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="w-[320px] flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">

        {/* Header + tabs */}
        <div className="px-4 pt-4 pb-0 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900 mb-3">Messages</h1>
          <div className="flex gap-1">
            {(['team', 'sms'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  tab === t
                    ? 'bg-white border border-b-white border-gray-200 text-blue-600 -mb-px z-10'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'team' ? '💬 Team' : '📱 SMS'}
              </button>
            ))}
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">

          {/* ── TEAM tab ─────────────────────────────────────────────────── */}
          {tab === 'team' && (
            <>
              <div className="p-3 border-b border-gray-100 space-y-2">
                <input
                  className="w-full h-8 px-3 rounded-lg bg-gray-50 border border-gray-200 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="Search members…"
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                />
                <div className="flex gap-2">
                  <select
                    className="flex-1 h-8 px-2 rounded-lg bg-gray-50 border border-gray-200 text-sm focus:outline-none"
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                  >
                    <option value="">New direct message…</option>
                    {filteredUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={createDm}
                    disabled={!selectedUserId}
                    className="h-8 px-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
                  >
                    Start
                  </button>
                </div>
              </div>

              {teamLoading ? (
                <div className="p-4 text-sm text-gray-400 text-center">Loading…</div>
              ) : teamConversations.length === 0 ? (
                <div className="p-4 text-sm text-gray-400 text-center">No conversations yet</div>
              ) : (
                teamConversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedTeamId(conv.id)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-gray-50 transition-colors ${
                      selectedTeamId === conv.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <Avatar label={conv.pinned ? '👥' : conv.title} color="blue" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className={`text-sm truncate ${conv.unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                          {conv.pinned ? 'Team Chat' : conv.title}
                        </span>
                        {conv.lastMessageAt && (
                          <span className="text-xs text-gray-400 flex-shrink-0">{relativeTime(conv.lastMessageAt)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 truncate flex-1">
                          {conv.lastMessage?.text || (conv.lastMessage ? `[${conv.lastMessage.type.toLowerCase()}]` : 'No messages')}
                        </span>
                        {conv.unreadCount > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold bg-blue-600 text-white flex items-center justify-center flex-shrink-0">
                            {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </>
          )}

          {/* ── SMS tab ──────────────────────────────────────────────────── */}
          {tab === 'sms' && (
            <>
              <div className="p-3 border-b border-gray-100">
                {showNewSms ? (
                  <div className="space-y-2">
                    <input
                      className="w-full h-9 px-3 rounded-lg bg-gray-50 border border-gray-200 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      placeholder="Phone number e.g. 845-782-1617"
                      value={newSmsPhone}
                      onChange={(e) => setNewSmsPhone(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') startNewSmsConversation() }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={startNewSmsConversation}
                        className="flex-1 h-8 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
                      >
                        Open Chat
                      </button>
                      <button
                        onClick={() => { setShowNewSms(false); setNewSmsPhone('') }}
                        className="h-8 px-3 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewSms(true)}
                    className="w-full h-9 rounded-lg border border-dashed border-emerald-300 text-emerald-600 text-sm font-medium hover:bg-emerald-50 transition-colors"
                  >
                    + New SMS
                  </button>
                )}
              </div>

              {smsLoading ? (
                <div className="p-4 text-sm text-gray-400 text-center">Loading…</div>
              ) : smsConversations.length === 0 ? (
                <div className="p-4 text-sm text-gray-400 text-center">No SMS conversations yet</div>
              ) : (
                smsConversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedSmsId(conv.id)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-gray-50 transition-colors ${
                      selectedSmsId === conv.id ? 'bg-emerald-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <Avatar label={conv.phoneDisplay || conv.phone} color="green" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <div className="min-w-0">
                          <span className={`text-sm truncate block ${conv.unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                            {conv.clientName || conv.phoneDisplay || conv.phone}
                          </span>
                          {conv.clientName && (
                            <span className="text-xs text-gray-400">{conv.phoneDisplay}</span>
                          )}
                        </div>
                        {conv.lastMessageAt && (
                          <span className="text-xs text-gray-400 flex-shrink-0">{relativeTime(conv.lastMessageAt)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 truncate flex-1">
                          {conv.lastMessage?.direction === 'OUTBOUND' ? '→ ' : ''}
                          {conv.lastMessage?.body || 'No messages'}
                        </span>
                        {conv.unreadCount > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                            {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </aside>

      {/* ── Main pane ────────────────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col min-w-0 bg-gray-50">

        {/* ── TEAM CHAT pane ───────────────────────────────────────────────── */}
        {tab === 'team' && (
          selectedTeamConversation ? (
            <>
              {/* Header */}
              <header className="h-14 px-5 bg-white border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
                <Avatar label={selectedTeamConversation.pinned ? '👥' : selectedTeamConversation.title} />
                <div>
                  <div className="font-semibold text-gray-900 text-sm">
                    {selectedTeamConversation.pinned ? 'Team Chat' : selectedTeamConversation.title}
                  </div>
                  <div className="text-xs text-gray-400">
                    {selectedTeamConversation.type === 'TEAM' ? 'All team members' : 'Direct message'}
                  </div>
                </div>
              </header>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
                {teamMessages.map((msg, i) => {
                  const mine = msg.senderId === currentUserId
                  const prev = i > 0 ? teamMessages[i - 1] : null
                  const showDate = !prev || new Date(msg.createdAt).toDateString() !== new Date(prev.createdAt).toDateString()
                  return (
                    <React.Fragment key={msg.id}>
                      {showDate && (
                        <div className="flex items-center gap-3 my-4">
                          <div className="flex-1 h-px bg-gray-200" />
                          <span className="text-xs text-gray-400 bg-gray-50 px-2">{dateSeparatorLabel(msg.createdAt)}</span>
                          <div className="flex-1 h-px bg-gray-200" />
                        </div>
                      )}
                      <div className={`flex ${mine ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                        {!mine && (
                          <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold flex-shrink-0 mb-0.5">
                            {fullName(msg.sender).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className={`max-w-[68%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white text-gray-900 rounded-bl-sm border border-gray-100 shadow-sm'}`}>
                          {selectedTeamConversation.type === 'TEAM' && !mine && (
                            <div className="text-[11px] font-semibold text-blue-500 mb-1">{fullName(msg.sender)}</div>
                          )}
                          {msg.jobId && (
                            <a href={`/dashboard/jobs/${msg.jobId}`}
                              className={`block mb-2 p-2 rounded-xl text-xs border ${mine ? 'bg-white/10 border-white/20 hover:bg-white/20' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'} transition-colors`}
                            >
                              <span className="font-semibold">📋 Job #{msg.jobNumber || 'N/A'}</span>
                              <span className={`block mt-0.5 ${mine ? 'text-blue-100' : 'text-gray-500'}`}>{msg.jobName || 'View job'}</span>
                            </a>
                          )}
                          {msg.text && <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</div>}
                          {msg.attachments.map((att) => (
                            <div key={att.id} className="mt-2">
                              {att.kind === 'IMAGE' && <a href={att.url} target="_blank" rel="noreferrer"><img src={att.url} alt={att.fileName || 'Image'} className="rounded-xl max-h-[240px] cursor-pointer hover:opacity-90 transition-opacity" /></a>}
                              {att.kind === 'VIDEO' && <video controls className="rounded-xl max-h-[240px]" src={att.url} />}
                              {att.kind === 'VOICE' && (
                                <div className={`flex items-center gap-2 p-2 rounded-xl ${mine ? 'bg-white/10' : 'bg-gray-100'}`}>
                                  <audio controls src={att.url} className="flex-1 h-8" />
                                  {att.durationMs && <span className="text-xs opacity-60">{Math.round(att.durationMs / 1000)}s</span>}
                                </div>
                              )}
                              {att.kind === 'FILE' && (
                                <a href={att.url} target="_blank" rel="noreferrer"
                                  className={`flex items-center gap-2 p-2 rounded-xl ${mine ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'} transition-colors`}
                                >
                                  <span>📄</span>
                                  <div className="min-w-0">
                                    <div className="text-sm truncate">{att.fileName || 'Download'}</div>
                                    {att.sizeBytes && <div className="text-xs opacity-60">{(att.sizeBytes / 1024).toFixed(0)} KB</div>}
                                  </div>
                                </a>
                              )}
                              {att.kind === 'LOCATION' && (
                                <a href={`https://maps.google.com/?q=${att.latitude},${att.longitude}`} target="_blank" rel="noreferrer"
                                  className={`flex items-center gap-2 p-2 rounded-xl ${mine ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'} transition-colors`}
                                >
                                  <span>📍</span>
                                  <span className="text-sm">Open in Maps</span>
                                </a>
                              )}
                            </div>
                          ))}
                          <div className={`mt-1 text-[10px] flex justify-end items-center gap-1 ${mine ? 'text-blue-100' : 'text-gray-400'}`}>
                            <span>{new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                            {mine && <span>{msg.status === 'READ' || msg.status === 'DELIVERED' ? '✓✓' : '✓'}</span>}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {/* Composer */}
              <footer className="bg-white border-t border-gray-200 px-4 py-3 flex-shrink-0">
                {teamDraftAttachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {teamDraftAttachments.map((a) => (
                      <div key={a.url} className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-lg">
                        <span>{a.kind === 'IMAGE' ? '🖼' : a.kind === 'VIDEO' ? '🎬' : '📄'}</span>
                        <span className="max-w-[120px] truncate">{a.fileName}</span>
                        <button onClick={() => setTeamDraftAttachments((p) => p.filter((x) => x.url !== a.url))} className="ml-1 text-gray-400 hover:text-gray-600">×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input type="file" multiple className="hidden" id="msg-upload-input" onChange={(e) => uploadFiles(e.target.files)} />

                  {/* Attachment */}
                  <button
                    title="Attach file"
                    onClick={() => document.getElementById('msg-upload-input')?.click()}
                    className="h-9 w-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                  </button>

                  {/* Location */}
                  <button
                    title="Send location"
                    onClick={sendLocation}
                    className="h-9 w-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </button>

                  {/* Mic */}
                  <button
                    title="Hold to record voice"
                    onMouseDown={startVoiceRecording}
                    onMouseUp={stopVoiceRecording}
                    onMouseLeave={() => teamRecording && stopVoiceRecording()}
                    onTouchStart={startVoiceRecording}
                    onTouchEnd={stopVoiceRecording}
                    className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${teamRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 hover:bg-gray-200 text-gray-500'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  </button>

                  {/* Text input */}
                  <textarea
                    value={teamText}
                    onChange={(e) => setTeamText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTeamMessage() } }}
                    rows={1}
                    className="flex-1 min-h-[36px] max-h-32 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300"
                    placeholder="Type a message… (Enter to send)"
                  />

                  {/* Send */}
                  <button
                    onClick={sendTeamMessage}
                    disabled={teamSending || (!teamText.trim() && teamDraftAttachments.length === 0)}
                    className="h-9 w-9 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center text-white flex-shrink-0 transition-colors"
                  >
                    <svg className="w-4 h-4 -mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-gray-400">
                <div className="text-4xl mb-3">💬</div>
                <div className="text-sm">Select a conversation or start a new one</div>
              </div>
            </div>
          )
        )}

        {/* ── SMS pane ─────────────────────────────────────────────────────── */}
        {tab === 'sms' && (
          selectedSmsConversation ? (
            <>
              {/* Header */}
              <header className="h-14 px-5 bg-white border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
                <Avatar label={selectedSmsConversation.phoneDisplay || selectedSmsConversation.phone} color="green" />
                <div>
                  <div className="font-semibold text-gray-900 text-sm">
                    {selectedSmsConversation.clientName || selectedSmsConversation.phoneDisplay || selectedSmsConversation.phone}
                  </div>
                  <div className="text-xs text-gray-400">
                    {selectedSmsConversation.clientName ? selectedSmsConversation.phoneDisplay : 'SMS conversation'}
                    {' · '}{selectedSmsConversation.channel}
                  </div>
                </div>
              </header>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
                {smsMessages.map((msg, i) => {
                  const mine = msg.direction === 'OUTBOUND'
                  const prev = i > 0 ? smsMessages[i - 1] : null
                  const showDate = !prev || new Date(msg.createdAt).toDateString() !== new Date(prev.createdAt).toDateString()
                  return (
                    <React.Fragment key={msg.id}>
                      {showDate && (
                        <div className="flex items-center gap-3 my-4">
                          <div className="flex-1 h-px bg-gray-200" />
                          <span className="text-xs text-gray-400 bg-gray-50 px-2">{dateSeparatorLabel(msg.createdAt)}</span>
                          <div className="flex-1 h-px bg-gray-200" />
                        </div>
                      )}
                      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[68%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-emerald-600 text-white rounded-br-sm' : 'bg-white text-gray-900 rounded-bl-sm border border-gray-100 shadow-sm'}`}>
                          {msg.body && <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.body}</div>}
                          {msg.media.map((m) => (
                            <div key={m.id} className="mt-2">
                              {m.type === 'image' || m.mimeType?.startsWith('image/') ? (
                                <a href={m.url} target="_blank" rel="noreferrer">
                                  <img src={m.url} alt="MMS" className="rounded-xl max-h-[240px] cursor-pointer hover:opacity-90 transition-opacity" />
                                </a>
                              ) : (
                                <a href={m.url} target="_blank" rel="noreferrer" className={`flex items-center gap-2 p-2 rounded-xl ${mine ? 'bg-white/10' : 'bg-gray-100'}`}>
                                  <span>📎</span><span className="text-sm">Media attachment</span>
                                </a>
                              )}
                            </div>
                          ))}
                          <div className={`mt-1 text-[10px] flex justify-end items-center gap-1 ${mine ? 'text-emerald-100' : 'text-gray-400'}`}>
                            <span>{new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                            {mine && <span>{msg.status === 'DELIVERED' || msg.status === 'READ' ? '✓✓' : '✓'}</span>}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {/* SMS Composer */}
              <footer className="bg-white border-t border-gray-200 px-4 py-3 flex-shrink-0">
                <div className="flex items-end gap-2">
                  <textarea
                    value={smsText}
                    onChange={(e) => setSmsText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSmsMessage() } }}
                    rows={1}
                    className="flex-1 min-h-[36px] max-h-32 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-300"
                    placeholder="Type an SMS message… (Enter to send)"
                    disabled={smsSending}
                  />
                  <button
                    onClick={sendSmsMessage}
                    disabled={smsSending || !smsText.trim()}
                    className="h-9 w-9 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 flex items-center justify-center text-white flex-shrink-0 transition-colors"
                  >
                    <svg className="w-4 h-4 -mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  </button>
                </div>
                <div className="mt-1.5 text-[11px] text-gray-400 text-center">
                  Sending via VoIP.ms · SMS charges may apply
                </div>
              </footer>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-gray-400">
                <div className="text-4xl mb-3">📱</div>
                <div className="text-sm font-medium text-gray-500 mb-1">SMS Conversations</div>
                <div className="text-xs">Select an existing thread or click<br />+ New SMS to start one</div>
              </div>
            </div>
          )
        )}
      </section>
    </div>
  )
}
