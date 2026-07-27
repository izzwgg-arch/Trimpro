'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { refreshAccessToken } from '@/lib/auth/client'
import { smartMatch, scoreHaystack } from '@/lib/search/scoring'

// ─── Unified thread shape ──────────────────────────────────────────────────────

type UnifiedThread = {
  id: string
  kind: 'team' | 'sms'
  channel: 'team' | 'SMS' | 'MMS'
  title: string
  subtitle?: string | null
  phone?: string       // E.164
  phoneDisplay?: string
  unreadCount: number
  lastMessageAt: string | null
  preview: string | null
  previewIsOutbound?: boolean
  pinned: boolean
  convType: string     // TEAM / DM / JOB_THREAD / SMS / MMS
  jobId?: string | null
}

// ─── Normalised message shape for rendering ────────────────────────────────────

type MsgAttachment = {
  kind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'LOCATION'
  url: string
  fileName?: string | null
  mimeType?: string | null
  durationMs?: number | null
  sizeBytes?: number | null
  latitude?: number | null
  longitude?: number | null
}

type ReactionEntry = { emoji: string; userId: string; userName: string }

type ReplyInfo = {
  messageId: string
  senderName: string
  textPreview: string
  type?: string | null
} | null

type NormalizedMsg = {
  id: string
  isMine: boolean
  senderName?: string | null   // sender display name (only rendered in TEAM group chat, but kept for reply quotes)
  text: string | null
  createdAt: string
  status?: string
  jobId?: string | null
  jobNumber?: string | null
  jobName?: string | null
  attachments: MsgAttachment[]
  replyTo?: ReplyInfo
  reactions: ReactionEntry[]
  canInteract: boolean   // reply/react supported on internal chats (TEAM / DM / JOB_THREAD)
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

function attachmentPreviewLabel(att?: MsgAttachment) {
  if (!att) return 'Attachment'
  if (att.kind === 'IMAGE') return 'Photo'
  if (att.kind === 'VIDEO') return 'Video'
  if (att.kind === 'AUDIO') return 'Voice note'
  if (att.kind === 'LOCATION') return 'Location'
  return att.fileName || 'File'
}

function replyPreviewText(msg: NormalizedMsg) {
  return msg.text || attachmentPreviewLabel(msg.attachments[0])
}

type UserRow = { id: string; firstName: string | null; lastName: string | null; email: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : (parts[0]?.[0] || '?').toUpperCase()
}

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  const dt = new Date(iso)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dateSep(iso: string) {
  const d = new Date(iso)
  const t = new Date()
  const y = new Date(t); y.setDate(t.getDate() - 1)
  if (d.toDateString() === t.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function msgTimeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** Relative `/uploads/...` URLs need an origin for `<audio>` / `<video>` in some browsers and dev setups. */
function resolveMessageMediaUrl(url: string): string {
  if (!url) return url
  if (/^https?:\/\//i.test(url)) return url
  if (typeof window === 'undefined') return url
  const path = url.startsWith('/') ? url : `/${url}`
  return `${window.location.origin}${path}`
}

// Convert a raw ChatMessage (team) to NormalizedMsg
function normaliseTeamMsg(raw: any, myId: string): NormalizedMsg {
  const atts: MsgAttachment[] = (raw.attachments || []).map((a: any): MsgAttachment => {
    const k = String(a.kind || '').toUpperCase()
    const kind: MsgAttachment['kind'] =
      k === 'IMAGE' ? 'IMAGE'
      : k === 'VIDEO' ? 'VIDEO'
      : k === 'VOICE' ? 'AUDIO'
      : k === 'LOCATION' ? 'LOCATION'
      : 'FILE'
    return {
      kind,
      url: resolveMessageMediaUrl(typeof a.url === 'string' ? a.url : ''),
      fileName: a.fileName,
      mimeType: a.mimeType,
      durationMs: a.durationMs,
      sizeBytes: a.sizeBytes,
      latitude: a.latitude,
      longitude: a.longitude,
    }
  })
  const sender = raw.sender
  // Always resolve the sender's display name (used for group labels and reply quotes),
  // even though the bubble only renders it visibly for non-mine messages in group chats.
  const senderName = sender
    ? (`${sender.firstName || ''} ${sender.lastName || ''}`.trim() || sender.email)
    : null
  const replyTo: ReplyInfo = raw.replyTo
    ? {
        messageId: raw.replyTo.messageId,
        senderName: raw.replyTo.senderName || 'Unknown',
        textPreview: raw.replyTo.textPreview || '',
        type: raw.replyTo.type || null,
      }
    : null
  const reactions: ReactionEntry[] = Array.isArray(raw.reactions)
    ? raw.reactions.map((r: any) => ({ emoji: r.emoji, userId: r.userId, userName: r.userName }))
    : []
  return {
    id: raw.id,
    isMine: String(raw.senderId) === String(myId),
    senderName,
    text: raw.text || null,
    createdAt: raw.createdAt,
    status: raw.status,
    jobId: raw.jobId,
    jobNumber: raw.jobNumber,
    jobName: raw.jobName,
    attachments: atts,
    replyTo,
    reactions,
    canInteract: true,
  }
}

// Convert a raw SMS Message to NormalizedMsg
function normaliseSmsMsg(raw: any): NormalizedMsg {
  const mediaArr: any[] = raw.media || []
  const atts: MsgAttachment[] = mediaArr.map((m: any): MsgAttachment => {
    const mime = String(m.mimeType || '')
    const type = String(m.type || '')
    const kind: MsgAttachment['kind'] =
      mime.startsWith('image/') || type === 'image' ? 'IMAGE'
      : mime.startsWith('video/') || type === 'video' ? 'VIDEO'
      : mime.startsWith('audio/') || type === 'audio' ? 'AUDIO'
      : 'FILE'
    return {
      kind,
      url: resolveMessageMediaUrl(typeof m.url === 'string' ? m.url : ''),
      fileName: m.filename || null,
      mimeType: m.mimeType || null,
    }
  })
  return {
    id: raw.id,
    isMine: raw.direction === 'OUTBOUND',
    text: raw.body || null,
    createdAt: raw.createdAt,
    status: raw.status,
    attachments: atts,
    replyTo: null,
    reactions: [],
    canInteract: false, // reply/react are not yet supported on the SMS/MMS backend
  }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ThreadBadge({ kind, convType }: { kind: 'team' | 'sms'; convType: string }) {
  if (kind === 'sms') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-emerald-50 text-emerald-600 border border-emerald-100">
        {convType === 'MMS' ? 'MMS' : 'SMS'}
      </span>
    )
  }
  if (convType === 'DM') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-blue-50 text-blue-500 border border-blue-100">
        DM
      </span>
    )
  }
  if (convType === 'JOB_THREAD') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-amber-50 text-amber-600 border border-amber-100">
        JOB
      </span>
    )
  }
  return null
}

function AvatarCircle({ label, color }: { label: string; color: 'blue' | 'emerald' | 'violet' | 'gray' | 'amber' }) {
  const cls =
    color === 'emerald' ? 'bg-emerald-50 text-emerald-600 ring-emerald-100'
    : color === 'violet' ? 'bg-violet-50 text-violet-600 ring-violet-100'
    : color === 'amber' ? 'bg-amber-50 text-amber-600 ring-amber-100'
    : color === 'gray' ? 'bg-gray-100 text-gray-500 ring-gray-200'
    : 'bg-blue-50 text-blue-600 ring-blue-100'
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold ring-1 ${cls}`}>
      {initials(label)}
    </div>
  )
}

function ReactionPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])
  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-1.5 z-20 flex items-center gap-0.5 px-1.5 py-1 rounded-2xl bg-white shadow-lg border border-gray-100"
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onPick(emoji)}
          className="w-7 h-7 flex items-center justify-center text-base rounded-full hover:bg-gray-100 hover:scale-110 transition-transform"
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}

function MsgBubble({
  msg,
  showSenderName,
  myId,
  isHighlighted,
  onReply,
  onToggleReaction,
  onJumpTo,
}: {
  msg: NormalizedMsg
  showSenderName: boolean
  myId: string
  isHighlighted?: boolean
  onReply: (msg: NormalizedMsg) => void
  onToggleReaction: (messageId: string, emoji: string) => void
  onJumpTo: (messageId: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const reactionGroups = useMemo(() => {
    const map = new Map<string, { emoji: string; count: number; mine: boolean; names: string[] }>()
    for (const r of msg.reactions) {
      const entry = map.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false, names: [] }
      entry.count += 1
      entry.names.push(r.userName)
      if (String(r.userId) === String(myId)) entry.mine = true
      map.set(r.emoji, entry)
    }
    return Array.from(map.values())
  }, [msg.reactions, myId])

  return (
    <div
      id={`msg-${msg.id}`}
      className={`flex group ${msg.isMine ? 'justify-end' : 'justify-start'} ${
        isHighlighted ? 'transition-colors duration-500' : ''
      }`}
    >
      <div className={`flex items-end gap-1 max-w-[80%] ${msg.isMine ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Hover toolbar: reply + react */}
        {msg.canInteract && (
          <div className="relative flex items-center gap-0.5 pb-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex-shrink-0">
            <button
              type="button"
              title="Reply"
              onClick={() => onReply(msg)}
              className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 016 6v1" /></svg>
            </button>
            <button
              type="button"
              title="React"
              onClick={() => setPickerOpen((p) => !p)}
              className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
            {pickerOpen && (
              <ReactionPicker
                onPick={(emoji) => { onToggleReaction(msg.id, emoji); setPickerOpen(false) }}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
        )}

      <div className={`max-w-full flex flex-col ${msg.isMine ? 'items-end' : 'items-start'} ${isHighlighted ? 'rounded-2xl ring-2 ring-amber-300' : ''}`}>
        {/* Sender name (group only) */}
        {!msg.isMine && showSenderName && msg.senderName && (
          <span className="text-[11px] font-semibold text-indigo-500 mb-0.5 ml-1">{msg.senderName}</span>
        )}

        {/* Reply quote */}
        {msg.replyTo && (
          <button
            type="button"
            onClick={() => onJumpTo(msg.replyTo!.messageId)}
            className={`mb-1 max-w-[280px] text-left px-2.5 py-1.5 rounded-lg border-l-2 text-xs transition-colors ${
              msg.isMine
                ? 'bg-blue-50 border-blue-300 text-blue-800 hover:bg-blue-100'
                : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-150'
            }`}
          >
            <div className="font-semibold truncate">{msg.replyTo.senderName}</div>
            <div className="truncate opacity-80">{msg.replyTo.textPreview || 'Attachment'}</div>
          </button>
        )}

        {/* Job link */}
        {msg.jobId && (
          <a
            href={`/dashboard/jobs/${msg.jobId}`}
            className={`mb-1.5 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
              msg.isMine
                ? 'bg-blue-500 text-blue-50 hover:bg-blue-400'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-150'
            }`}
          >
            <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            Job #{msg.jobNumber || 'N/A'}{msg.jobName ? ` · ${msg.jobName}` : ''}
          </a>
        )}

        {/* Attachments */}
        {msg.attachments.map((att, idx) => (
          <AttachmentItem key={idx} att={att} isMine={msg.isMine} />
        ))}

        {/* Text bubble */}
        {(msg.text || msg.attachments.length === 0) && (
          <div
            className={`relative px-4 py-2.5 leading-relaxed ${
              msg.isMine
                ? 'bg-blue-600 text-white rounded-2xl rounded-br-sm'
                : 'bg-gray-100 text-gray-900 rounded-2xl rounded-bl-sm'
            }`}
          >
            {msg.text && <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>}
            <div className={`mt-1 flex items-center gap-1 justify-end ${msg.isMine ? 'text-blue-200' : 'text-gray-400'}`}>
              <span className="text-[10px]">{msgTimeStr(msg.createdAt)}</span>
              {msg.isMine && (
                <span className="text-[10px]">
                  {msg.status === 'READ' || msg.status === 'DELIVERED' ? '✓✓' : '✓'}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Timestamp when text-less media */}
        {msg.text === null && msg.attachments.length > 0 && (
          <span className={`text-[10px] mt-0.5 ${msg.isMine ? 'text-gray-400' : 'text-gray-400'}`}>
            {msgTimeStr(msg.createdAt)}
            {msg.isMine && <span className="ml-1">{msg.status === 'READ' || msg.status === 'DELIVERED' ? '✓✓' : '✓'}</span>}
          </span>
        )}

        {/* Reaction chips */}
        {reactionGroups.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${msg.isMine ? 'justify-end' : 'justify-start'}`}>
            {reactionGroups.map((g) => (
              <button
                key={g.emoji}
                type="button"
                title={g.names.join(', ')}
                onClick={() => onToggleReaction(msg.id, g.emoji)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors ${
                  g.mine
                    ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>{g.emoji}</span>
                <span className="font-medium">{g.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

function AttachmentItem({ att, isMine }: { att: MsgAttachment; isMine: boolean }) {
  if (att.kind === 'IMAGE') {
    const src = resolveMessageMediaUrl(att.url)
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block mb-1">
        <img
          src={src}
          alt={att.fileName || 'Image'}
          className="rounded-2xl max-h-[260px] max-w-[280px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
        />
      </a>
    )
  }
  if (att.kind === 'VIDEO') {
    const src = resolveMessageMediaUrl(att.url)
    return (
      <video
        controls
        src={src}
        className="rounded-2xl max-h-[240px] max-w-[280px] mb-1"
      />
    )
  }
  if (att.kind === 'AUDIO') {
    const src = resolveMessageMediaUrl(att.url)
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl mb-1 ${isMine ? 'bg-blue-500' : 'bg-gray-200'}`}>
        <svg className={`w-4 h-4 flex-shrink-0 ${isMine ? 'text-white' : 'text-gray-500'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M12 3a9 9 0 110 18A9 9 0 0112 3zm0 2a7 7 0 100 14A7 7 0 0012 5zm-1 4h2v6h-2V9zM10 9a1 1 0 11-2 0 1 1 0 012 0zm6 0a1 1 0 11-2 0 1 1 0 012 0z"/></svg>
        <audio controls src={src} preload="metadata" className="h-7 w-40 opacity-90" />
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className={`text-[10px] underline ${isMine ? 'text-blue-100' : 'text-gray-500'}`}
        >
          Open
        </a>
        {att.durationMs && (
          <span className={`text-[10px] flex-shrink-0 ${isMine ? 'text-blue-100' : 'text-gray-500'}`}>
            {Math.round(att.durationMs / 1000)}s
          </span>
        )}
      </div>
    )
  }
  if (att.kind === 'LOCATION') {
    return (
      <a
        href={`https://maps.google.com/?q=${att.latitude},${att.longitude}`}
        target="_blank"
        rel="noreferrer"
        className={`flex items-center gap-2 px-3 py-2 rounded-2xl mb-1 text-sm ${isMine ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'} hover:opacity-80 transition-opacity`}
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        Open in Maps
      </a>
    )
  }
  // FILE
  return (
    <a
      href={resolveMessageMediaUrl(att.url)}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2 px-3 py-2 rounded-2xl mb-1 text-sm max-w-[240px] transition-opacity hover:opacity-80 ${isMine ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
    >
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
      <div className="min-w-0">
        <div className="truncate font-medium">{att.fileName || 'Download file'}</div>
        {att.sizeBytes && <div className="text-[10px] opacity-70">{(att.sizeBytes / 1024).toFixed(0)} KB</div>}
      </div>
    </a>
  )
}

// ─── Composer ──────────────────────────────────────────────────────────────────

type DraftMedia = { url: string; type: string; mimeType: string; filename: string; preview?: string }

function Composer({
  isSms,
  onSend,
  disabled,
  replyPreview,
  onClearReply,
}: {
  isSms: boolean
  onSend: (text: string, media: DraftMedia[], durationMs?: number) => Promise<void>
  disabled?: boolean
  replyPreview?: { senderName: string; textPreview: string } | null
  onClearReply?: () => void
}) {
  const [text, setText] = useState('')
  const [media, setMedia] = useState<DraftMedia[]>([])
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordStart, setRecordStart] = useState(0)
  const [recSecs, setRecSecs] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canSend = (text.trim().length > 0 || media.length > 0) && !sending && !recording

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [text])

  const handleUpload = async (files: FileList | null) => {
    if (!files || !files.length) return
    const token = localStorage.getItem('accessToken')
    for (let i = 0; i < Math.min(files.length, 8); i++) {
      const f = files[i]
      const fd = new FormData(); fd.append('file', f)
      const res = await fetch('/api/uploads/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || `Upload failed (${res.status})`)
        continue
      }
      const { url } = await res.json()
      const mediaType = f.type.startsWith('image/') ? 'image'
        : f.type.startsWith('video/') ? 'video'
        : f.type.startsWith('audio/') ? 'audio'
        : 'file'
      const preview = mediaType === 'image' ? URL.createObjectURL(f) : undefined
      setMedia((p) => [...p, { url, type: mediaType, mimeType: f.type, filename: f.name, preview }])
    }
  }

  const startRecording = async () => {
    if (recording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      const mimeType = mimeCandidates.find((t) => MediaRecorder.isTypeSupported(t)) || ''
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.start(250)
      setRecording(true)
      setRecordStart(Date.now())
      setRecSecs(0)
      timerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000)
    } catch {
      alert('Microphone access denied')
    }
  }

  const stopRecording = async () => {
    if (!recorderRef.current || !recording) return
    if (timerRef.current) clearInterval(timerRef.current)
    const durMs = Date.now() - recordStart
    const rec = recorderRef.current
    await new Promise<void>((resolve) => {
      rec.onstop = async () => {
        try {
          if (typeof rec.requestData === 'function') {
            try {
              rec.requestData()
            } catch {
              /* ignore */
            }
          }
          await new Promise((r) => setTimeout(r, 80))
          const blobType = rec.mimeType || 'audio/webm'
          const blob = new Blob(chunksRef.current, { type: blobType })
          if (!blob.size) {
            alert('Recording was empty. Try again and speak closer to the mic.')
            return
          }
          const ext = blobType.includes('mp4') ? 'm4a' : 'webm'
          const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blobType })
          const fd = new FormData()
          fd.append('file', file)
          const token = localStorage.getItem('accessToken')
          const res = await fetch('/api/uploads/messages', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            alert(err.error || `Voice upload failed (${res.status})`)
            return
          }
          const { url } = await res.json()
          setSending(true)
          await onSend('', [{ url, type: 'audio', mimeType: blobType, filename: file.name }], durMs).catch(() => {})
          setSending(false)
        } finally {
          resolve()
        }
      }
      rec.stop()
      rec.stream.getTracks().forEach((t) => t.stop())
    })
    setRecording(false); setRecSecs(0); recorderRef.current = null
  }

  const cancelRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    recorderRef.current?.stop()
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop())
    recorderRef.current = null; chunksRef.current = []
    setRecording(false); setRecSecs(0)
  }

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    await onSend(text.trim(), media).catch(() => {})
    setText(''); setMedia([])
    setSending(false)
  }

  return (
    <div className="bg-white border-t border-gray-100 px-4 py-3">
      {/* Reply preview */}
      {replyPreview && (
        <div className="mb-2 flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl bg-blue-50 border-l-2 border-blue-400">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-blue-700 truncate">Replying to {replyPreview.senderName}</div>
            <div className="text-xs text-blue-500 truncate">{replyPreview.textPreview}</div>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full text-blue-400 hover:text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Draft media row */}
      {media.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {media.map((m, i) => (
            <div key={i} className="relative group">
              {m.preview
                ? <img src={m.preview} alt="" className="w-14 h-14 rounded-xl object-cover border border-gray-100" />
                : (
                  <div className="w-14 h-14 rounded-xl bg-gray-100 flex flex-col items-center justify-center gap-0.5">
                    <span className="text-lg">{m.type === 'audio' ? '🎙' : m.type === 'video' ? '🎬' : '📄'}</span>
                    <span className="text-[9px] text-gray-500 truncate px-1 w-full text-center">{m.filename.slice(0, 8)}</span>
                  </div>
                )
              }
              <button
                onClick={() => setMedia((p) => p.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-800 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >×</button>
            </div>
          ))}
        </div>
      )}

      {recording ? (
        /* Recording UI */
        <div className="flex items-center gap-3 h-10">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm text-gray-600 flex-1 font-medium tabular-nums">
            Recording {String(Math.floor(recSecs / 60)).padStart(2, '0')}:{String(recSecs % 60).padStart(2, '0')}
          </span>
          <button onClick={cancelRecording} className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
          <button
            onClick={stopRecording}
            className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            Send
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          {/* Attach */}
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
          <button
            type="button"
            title="Attach file or media"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            className="h-9 w-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
          </button>

          {/* Mic */}
          <button
            type="button"
            title="Record voice note"
            onClick={startRecording}
            disabled={disabled}
            className="h-9 w-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
          </button>

          {/* Text */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={isSms ? 'Type an SMS…' : 'Type a message…'}
            disabled={disabled || sending}
            className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-shadow min-h-[36px]"
          />

          {/* Send */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="h-9 w-9 rounded-xl flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:opacity-30 text-white transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" /></svg>
          </button>
        </div>
      )}

      {isSms && (
        <p className="mt-1.5 text-[10px] text-gray-400 text-center leading-none">
          Sends via VoIP.ms · MMS charges may apply for attachments
        </p>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const deepLinkConversationId = searchParams.get('conversationId')
  const [myId, setMyId] = useState('')
  const [threads, setThreads] = useState<UnifiedThread[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkConversationId)
  const [messages, setMessages] = useState<NormalizedMsg[]>([])
  const [threadsLoading, setThreadsLoading] = useState(true)
  const [msgsLoading, setMsgsLoading] = useState(false)
  const [search, setSearch] = useState('')

  // Reply / reaction state (internal team / DM / job threads)
  const [replyTarget, setReplyTarget] = useState<NormalizedMsg | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  // New chat modal state
  const [newOpen, setNewOpen] = useState(false)
  const [newType, setNewType] = useState<'team' | 'sms'>('team')
  const [newUsers, setNewUsers] = useState<UserRow[]>([])
  const [newUserFilter, setNewUserFilter] = useState('')
  const [newUserId, setNewUserId] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [creating, setCreating] = useState(false)

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedThread = useMemo(() => threads.find((t) => t.id === selectedId) ?? null, [threads, selectedId])

  // ── Auth helper ────────────────────────────────────────────────────────────
  const fetchAuth = useCallback(async (url: string, init?: RequestInit) => {
    let token = localStorage.getItem('accessToken')
    if (!token) {
      if (!await refreshAccessToken()) { router.push('/auth/login'); throw new Error('unauth') }
      token = localStorage.getItem('accessToken')
    }
    let res = await fetch(url, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` } })
    if (res.status === 401) {
      if (!await refreshAccessToken()) { router.push('/auth/login'); throw new Error('unauth') }
      token = localStorage.getItem('accessToken')
      res = await fetch(url, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` } })
    }
    return res
  }, [router])

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('accessToken') || ''
    const parts = token.split('.')
    if (parts.length >= 2) {
      try { const p = JSON.parse(atob(parts[1])); if (p?.userId) setMyId(String(p.userId)) } catch {}
    }
  }, [])

  // ── Load threads ───────────────────────────────────────────────────────────
  const loadThreads = useCallback(async (selectFirst = false) => {
    // Ensure team conversation exists for this user
    fetchAuth('/api/messages/team/ensure', { method: 'POST' }).catch(() => {})
    const res = await fetchAuth('/api/messages/unified')
    if (!res.ok) return
    const data = await res.json()
    const list: UnifiedThread[] = data.threads || []
    setThreads(list)
    if (selectFirst && !selectedId && list.length > 0) setSelectedId(list[0].id)
  }, [fetchAuth, selectedId])

  useEffect(() => {
    if (!deepLinkConversationId) return
    setSelectedId(deepLinkConversationId)
  }, [deepLinkConversationId])

  useEffect(() => {
    setThreadsLoading(true)
    loadThreads(true).finally(() => setThreadsLoading(false))
  }, [])

  // ── Load messages for selected thread ──────────────────────────────────────
  const loadMessages = useCallback(async (thread: UnifiedThread) => {
    setMsgsLoading(true)
    try {
      if (thread.kind === 'team') {
        const res = await fetchAuth(`/api/messages/conversations/${thread.id}/messages?limit=80`)
        if (!res.ok) return
        const data = await res.json()
        const rawMsgs: any[] = (data.messages || []).reverse()
        setMessages(rawMsgs.map((m) => normaliseTeamMsg(m, myId)))
        // Mark read
        fetchAuth(`/api/messages/conversations/${thread.id}/read`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        }).catch(() => {})
      } else {
        const res = await fetchAuth(`/api/sms/conversations/${thread.id}/messages`)
        if (!res.ok) return
        const data = await res.json()
        setMessages((data.messages || []).map(normaliseSmsMsg))
      }
    } finally {
      setMsgsLoading(false)
    }
  }, [fetchAuth, myId])

  useEffect(() => {
    if (!selectedThread) return
    loadMessages(selectedThread)
  }, [selectedId]) // eslint-disable-line

  // Clear any pending reply / jump-highlight when switching threads
  useEffect(() => {
    setReplyTarget(null)
    setHighlightedId(null)
  }, [selectedId])

  const jumpToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedId(messageId)
    window.setTimeout(() => setHighlightedId((cur) => (cur === messageId ? null : cur)), 1600)
  }, [])

  const handleReply = useCallback((msg: NormalizedMsg) => {
    if (!msg.canInteract) return
    setReplyTarget(msg)
  }, [])

  const handleToggleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!selectedThread || selectedThread.kind !== 'team') return
    try {
      const res = await fetchAuth(`/api/messages/conversations/${selectedThread.id}/messages/${messageId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      })
      if (!res.ok) return
      const data = await res.json()
      const reactions: ReactionEntry[] = data.reactions || []
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)))
    } catch {
      /* best-effort; UI will resync on next poll/SSE update */
    }
  }, [selectedThread, fetchAuth])

  // ── SSE for team chats ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedThread || selectedThread.kind !== 'team') return
    const token = localStorage.getItem('accessToken')
    if (!token) return
    const src = new EventSource(`/api/messages/stream?token=${encodeURIComponent(token)}&since=${encodeURIComponent(new Date().toISOString())}`)
    src.addEventListener('new_message', async (e) => {
      const p = JSON.parse((e as MessageEvent).data)
      if (p.conversationId === selectedId) await loadMessages(selectedThread)
      loadThreads()
    })
    return () => src.close()
  }, [selectedId]) // eslint-disable-line

  // ── Poll SMS threads ───────────────────────────────────────────────────────
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!selectedThread || selectedThread.kind !== 'sms') return
    pollRef.current = setInterval(() => {
      loadMessages(selectedThread)
      loadThreads()
    }, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [selectedId]) // eslint-disable-line

  // ── Scroll bottom ──────────────────────────────────────────────────────────
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text: string, media: DraftMedia[], durationMs?: number) => {
    if (!selectedThread) return
    if (selectedThread.kind === 'team') {
      const attachments = media.map((m) => ({
        kind: m.type === 'audio' ? 'VOICE' : m.type === 'image' ? 'IMAGE' : m.type === 'video' ? 'VIDEO' : 'FILE',
        url: m.url,
        fileName: m.filename,
        mimeType: m.mimeType,
        durationMs: durationMs || null,
      }))
      const res = await fetchAuth(`/api/messages/conversations/${selectedThread.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text || null,
          clientTempId: `web-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          attachments,
          replyToMessageId: replyTarget?.id || null,
          replyToSenderName: replyTarget ? (replyTarget.isMine ? 'You' : (replyTarget.senderName || 'Unknown')) : null,
          replyToText: replyTarget ? replyPreviewText(replyTarget) : null,
          replyToType: replyTarget
            ? (replyTarget.attachments.length === 0 ? 'TEXT'
              : replyTarget.attachments[0].kind === 'AUDIO' ? 'VOICE'
              : replyTarget.attachments[0].kind === 'LOCATION' ? 'LOCATION'
              : 'MEDIA')
            : null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || `Failed to send message (${res.status})`)
        return
      }
      setReplyTarget(null)
    } else {
      // SMS / MMS
      const mediaPayload = media.map((m) => ({
        url: m.url, type: m.type, mimeType: m.mimeType, filename: m.filename,
      }))
      const res = await fetchAuth(`/api/sms/conversations/${selectedThread.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text || undefined, media: mediaPayload.length > 0 ? mediaPayload : undefined }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Failed to send'); return }
    }
    await loadMessages(selectedThread)
    await loadThreads()
  }, [selectedThread, fetchAuth, loadMessages, loadThreads, replyTarget])

  // ── New chat ───────────────────────────────────────────────────────────────
  const openNewChat = async () => {
    if (!newUsers.length) {
      const res = await fetchAuth('/api/messages/users')
      if (res.ok) { const d = await res.json(); setNewUsers(d.users || []) }
    }
    setNewOpen(true)
  }

  const filteredUsers = useMemo(() => {
    const q = newUserFilter.trim()
    if (!q) return newUsers
    return [...newUsers]
      .filter((u) => smartMatch(q, [u.firstName, u.lastName, u.email]))
      .sort(
        (a, b) =>
          scoreHaystack(q, [`${b.firstName} ${b.lastName}`, b.email], []) -
          scoreHaystack(q, [`${a.firstName} ${a.lastName}`, a.email], [])
      )
  }, [newUsers, newUserFilter])

  const createNewChat = async () => {
    setCreating(true)
    try {
      if (newType === 'team') {
        if (!newUserId) return
        const res = await fetchAuth('/api/messages/dm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: newUserId }),
        })
        if (!res.ok) return
        const d = await res.json()
        await loadThreads()
        setSelectedId(d.conversationId)
      } else {
        const phone = newPhone.trim()
        if (!phone) return
        const res = await fetchAuth('/api/sms/conversations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        })
        if (!res.ok) { alert('Failed to start SMS conversation'); return }
        const d = await res.json()
        await loadThreads()
        setSelectedId(d.conversationId)
      }
      setNewOpen(false); setNewUserId(''); setNewPhone(''); setNewUserFilter('')
    } finally { setCreating(false) }
  }

  // ── Filtered thread list ───────────────────────────────────────────────────
  const filteredThreads = useMemo(() => {
    const q = search.trim()
    if (!q) return threads
    return threads.filter((t) =>
      smartMatch(q, [t.title, t.subtitle, t.phoneDisplay, t.phone, t.preview])
    )
  }, [threads, search])

  // ── Avatar color by kind ───────────────────────────────────────────────────
  function threadAvatarColor(t: UnifiedThread): 'blue' | 'emerald' | 'violet' | 'gray' | 'amber' {
    if (t.kind === 'sms') return 'emerald'
    if (t.convType === 'TEAM') return 'violet'
    if (t.convType === 'JOB_THREAD') return 'amber'
    return 'blue'
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] bg-white overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-[300px] flex-shrink-0 border-r border-gray-100 flex flex-col">

        {/* Header */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base font-bold text-gray-900">Messages</h1>
            <button
              onClick={openNewChat}
              className="w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-700 flex items-center justify-center text-white transition-colors"
              title="New conversation"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full h-8 px-3 rounded-xl bg-gray-50 border border-gray-100 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {threadsLoading ? (
            <div className="pt-12 text-center text-sm text-gray-400">Loading…</div>
          ) : filteredThreads.length === 0 ? (
            <div className="pt-12 text-center text-sm text-gray-400">No conversations yet</div>
          ) : (
            filteredThreads.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-gray-50 transition-colors ${
                  selectedId === t.id ? 'bg-blue-50/80' : 'hover:bg-gray-50'
                }`}
              >
                <AvatarCircle label={t.title} color={threadAvatarColor(t)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1 mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-sm truncate ${t.unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                        {t.title}
                      </span>
                      <ThreadBadge kind={t.kind} convType={t.convType} />
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {t.lastMessageAt && (
                        <span className="text-[10px] text-gray-400">{relTime(t.lastMessageAt)}</span>
                      )}
                    </div>
                  </div>
                  {t.subtitle && <div className="text-[11px] text-gray-400 mb-0.5">{t.subtitle}</div>}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 truncate flex-1">
                      {t.previewIsOutbound ? '→ ' : ''}{t.preview || 'No messages'}
                    </span>
                    {t.unreadCount > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-blue-600 text-white flex items-center justify-center">
                        {t.unreadCount > 99 ? '99+' : t.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── Thread pane ─────────────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col min-w-0 bg-gray-50">
        {!selectedThread ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400 select-none">
              <div className="text-5xl mb-3 opacity-30">💬</div>
              <div className="text-sm font-medium text-gray-400">Select a conversation</div>
              <button
                onClick={openNewChat}
                className="mt-3 text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2"
              >
                or start a new one
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <header className="h-14 px-5 bg-white border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
              <AvatarCircle label={selectedThread.title} color={threadAvatarColor(selectedThread)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 text-sm truncate">{selectedThread.title}</span>
                  <ThreadBadge kind={selectedThread.kind} convType={selectedThread.convType} />
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {selectedThread.kind === 'sms'
                    ? (selectedThread.subtitle || selectedThread.phoneDisplay || 'SMS conversation')
                    : selectedThread.convType === 'TEAM' ? 'Team · all members'
                    : selectedThread.convType === 'JOB_THREAD' ? 'Job thread · assigned crew & office'
                    : 'Direct message'
                  }
                </div>
              </div>
              {selectedThread.convType === 'JOB_THREAD' && selectedThread.jobId && (
                <a
                  href={`/dashboard/jobs/${selectedThread.jobId}`}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100 hover:bg-amber-100 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  View Job
                </a>
              )}
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-1">
              {msgsLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-sm text-gray-400">Loading messages…</div>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-gray-400">
                    <div className="text-3xl mb-2 opacity-30">👋</div>
                    <div className="text-sm">No messages yet. Say hello!</div>
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const prev = i > 0 ? messages[i - 1] : null
                  const showDate = !prev || new Date(msg.createdAt).toDateString() !== new Date(prev.createdAt).toDateString()
                  // Group consecutive same-sender messages
                  const next = i < messages.length - 1 ? messages[i + 1] : null
                  const isLastInGroup = !next || next.isMine !== msg.isMine
                  const showName =
                    !msg.isMine &&
                    (selectedThread.convType === 'TEAM' || selectedThread.convType === 'JOB_THREAD') &&
                    (!prev || prev.isMine !== msg.isMine)

                  return (
                    <React.Fragment key={msg.id}>
                      {showDate && (
                        <div className="flex items-center gap-3 my-3">
                          <div className="flex-1 h-px bg-gray-200" />
                          <span className="text-[11px] text-gray-400 font-medium px-2">{dateSep(msg.createdAt)}</span>
                          <div className="flex-1 h-px bg-gray-200" />
                        </div>
                      )}
                      <div className={isLastInGroup ? 'mb-2' : 'mb-0.5'}>
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
                    </React.Fragment>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <Composer
              isSms={selectedThread.kind === 'sms'}
              onSend={handleSend}
              replyPreview={
                replyTarget
                  ? { senderName: replyTarget.isMine ? 'You' : (replyTarget.senderName || 'Unknown'), textPreview: replyPreviewText(replyTarget) }
                  : null
              }
              onClearReply={() => setReplyTarget(null)}
            />
          </>
        )}
      </section>

      {/* ── New conversation modal ──────────────────────────────────────────── */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setNewOpen(false)} />
          <div className="relative w-[380px] bg-white rounded-2xl shadow-xl p-6 z-10">
            <h2 className="text-base font-bold text-gray-900 mb-4">New Conversation</h2>

            {/* Type selector */}
            <div className="flex gap-2 mb-5">
              {(['team', 'sms'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setNewType(type)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors border ${
                    newType === type
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {type === 'team' ? '👥 Team / DM' : '📱 SMS'}
                </button>
              ))}
            </div>

            {newType === 'team' ? (
              <div className="space-y-3">
                <input
                  value={newUserFilter}
                  onChange={(e) => setNewUserFilter(e.target.value)}
                  placeholder="Search team members…"
                  className="w-full h-9 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-gray-50"
                />
                <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-50">
                  {filteredUsers.length === 0 ? (
                    <div className="py-6 text-center text-sm text-gray-400">No users found</div>
                  ) : filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => setNewUserId(u.id)}
                      className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors ${
                        newUserId === u.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">
                        {initials(`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">
                          {`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}
                        </div>
                        {(u.firstName || u.lastName) && <div className="text-xs text-gray-400 truncate">{u.email}</div>}
                      </div>
                      {newUserId === u.id && <svg className="w-4 h-4 text-blue-600 ml-auto flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Phone Number</label>
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createNewChat() }}
                  placeholder="(845) 782-1617"
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-gray-50"
                  autoFocus
                />
                <p className="mt-1.5 text-xs text-gray-400">E.g. 845-782-1617 or +18457821617</p>
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setNewOpen(false); setNewUserId(''); setNewPhone(''); setNewUserFilter('') }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createNewChat}
                disabled={creating || (newType === 'team' ? !newUserId : !newPhone.trim())}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium transition-colors"
              >
                {creating ? 'Opening…' : 'Start Chat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
