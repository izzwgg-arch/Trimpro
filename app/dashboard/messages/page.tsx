'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Search,
  MessageSquare,
  Send,
  Phone,
  Mail,
  Filter,
  X,
  Image as ImageIcon,
  Paperclip,
  RefreshCw,
  Check,
  CheckCheck,
  AlertCircle,
  UserPlus,
  Plus,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

interface Conversation {
  id: string
  channel: 'SMS' | 'MMS' | 'WHATSAPP' | 'EMAIL'
  clientId: string | null
  assignedUserId: string | null
  status: 'ACTIVE' | 'ARCHIVED' | 'CLOSED'
  participants: string[]
  lastMessageAt: string | null
  unreadCount: number
  client?: {
    id: string
    name: string
    phone: string | null
    email: string | null
  } | null
  assignedUser?: {
    id: string
    firstName: string
    lastName: string
  } | null
  messages?: Array<{
    id: string
    body: string | null
    direction: 'INBOUND' | 'OUTBOUND'
    createdAt: string
  }>
}

interface Message {
  id: string
  direction: 'INBOUND' | 'OUTBOUND'
  body: string | null
  fromNumber: string | null
  toNumber: string | null
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'READ'
  createdAt: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  failedAt: string | null
  errorMessage: string | null
  media: Array<{
    id: string
    type: string
    url: string
    thumbnailUrl: string | null
    mimeType: string | null
    filename: string | null
  }>
}

interface ConversationDetail extends Conversation {
  messages: Message[]
}

export default function MessagesPage() {
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [attachments, setAttachments] = useState<Array<{ url: string; filename?: string; mimeType?: string }>>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterChannel, setFilterChannel] = useState<string>('all')
  const [showNewConversation, setShowNewConversation] = useState(false)
  const [newConversationTo, setNewConversationTo] = useState('')
  const [newConversationChannel, setNewConversationChannel] = useState<'SMS' | 'MMS' | 'WHATSAPP'>('SMS')
  const [newConversationClientId, setNewConversationClientId] = useState<string>('none')
  const [clients, setClients] = useState<Array<{ id: string; name: string; phone: string | null }>>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!showEmoji) return
      if (emojiRef.current && !emojiRef.current.contains(e.target as any)) {
        setShowEmoji(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [showEmoji])

  useEffect(() => {
    fetchConversations()
    fetchClients()
    // Poll for new messages every 5 seconds
    const interval = setInterval(fetchConversations, 5000)
    return () => clearInterval(interval)
  }, [search, filterStatus, filterChannel])

  useEffect(() => {
    if (selectedConversation) {
      fetchConversationDetail(selectedConversation.id)
      // Poll for new messages in selected conversation
      const interval = setInterval(() => {
        if (selectedConversation) {
          fetchConversationDetail(selectedConversation.id)
        }
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [selectedConversation?.id])

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedConversation?.messages])

  const refreshToken = async (): Promise<boolean> => {
    const refreshToken = localStorage.getItem('refreshToken')
    if (!refreshToken) {
      router.push('/auth/login')
      return false
    }

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })

      if (response.ok) {
        const data = await response.json()
        localStorage.setItem('accessToken', data.accessToken)
        localStorage.setItem('refreshToken', data.refreshToken)
        return true
      } else {
        router.push('/auth/login')
        return false
      }
    } catch (error) {
      router.push('/auth/login')
      return false
    }
  }

  const fetchConversations = async () => {
    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
      }

      const params = new URLSearchParams()
      if (search) params.append('search', search)
      if (filterStatus !== 'all') params.append('status', filterStatus)
      if (filterChannel !== 'all') params.append('channel', filterChannel)

      let response = await fetch(`/api/messages/conversations?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
        response = await fetch(`/api/messages/conversations?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      }

      if (response.ok) {
        const data = await response.json()
        setConversations(data.conversations || [])
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchConversationDetail = async (conversationId: string) => {
    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
      }

      let response = await fetch(`/api/messages/conversations/${conversationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
        response = await fetch(`/api/messages/conversations/${conversationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      }

      if (response.ok) {
        const data = await response.json()
        console.log('Fetched conversation:', {
          messageCount: data.conversation?.messages?.length,
          messagesWithMedia: data.conversation?.messages?.filter((m: any) => m.media && m.media.length > 0).map((m: any) => ({
            id: m.id,
            body: m.body,
            mediaCount: m.media.length,
            media: m.media.map((med: any) => ({ 
              id: med.id,
              type: med.type, 
              url: med.url,
              filename: med.filename 
            }))
          }))
        })
        setSelectedConversation(data.conversation)
      }
    } catch (error) {
      console.error('Failed to fetch conversation:', error)
    }
  }

  const fetchClients = async () => {
    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
      }

      let response = await fetch('/api/clients?limit=1000', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
        response = await fetch('/api/clients?limit=1000', {
          headers: { Authorization: `Bearer ${token}` },
        })
      }

      if (response.ok) {
        const data = await response.json()
        setClients(data.clients || [])
      }
    } catch (error) {
      console.error('Failed to fetch clients:', error)
    }
  }

  const handleSendMessage = async () => {
    if ((!messageText.trim() && attachments.length === 0) || !selectedConversation || sending) {
      console.log('Send blocked:', { hasText: !!messageText.trim(), hasAttachments: attachments.length > 0, hasConversation: !!selectedConversation, sending })
      return
    }

    setSending(true)
    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) {
          setSending(false)
          return
        }
        token = localStorage.getItem('accessToken')
      }

      const to = selectedConversation.participants[0]
      if (!to) {
        alert('No recipient found')
        setSending(false)
        return
      }

      const channelToSend =
        attachments.length > 0 && (selectedConversation.channel === 'SMS' || selectedConversation.channel === 'MMS')
          ? 'MMS'
          : selectedConversation.channel

      let response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          to,
          body: messageText,
          channel: channelToSend,
          media:
            attachments.length > 0
              ? attachments.map((a) => ({
                  type: 'image',
                  url: a.url,
                  filename: a.filename,
                  mimeType: a.mimeType,
                }))
              : undefined,
        }),
      })

      if (response.status === 401) {
        const refreshed = await refreshToken()
        if (!refreshed) {
          setSending(false)
          return
        }
        token = localStorage.getItem('accessToken')
        response = await fetch('/api/messages/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            conversationId: selectedConversation.id,
            to,
            body: messageText,
            channel: channelToSend,
            media:
              attachments.length > 0
                ? attachments.map((a) => ({
                    type: 'image',
                    url: a.url,
                    filename: a.filename,
                    mimeType: a.mimeType,
                  }))
                : undefined,
          }),
        })
      }

      if (response.ok) {
        setMessageText('')
        setAttachments([])
        // Small delay to ensure database transaction completes
        await new Promise(resolve => setTimeout(resolve, 300))
        // Refresh conversation to show new message with media
        await fetchConversationDetail(selectedConversation.id)
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to send message')
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      alert('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const insertEmoji = (emoji: string) => {
    setMessageText((t) => `${t}${emoji}`)
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (uploading) return

    setUploading(true)
    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
      }

      const newAttachments: Array<{ url: string; filename?: string; mimeType?: string }> = []
      const max = Math.min(files.length, 5)
      for (let i = 0; i < max; i++) {
        const file = files[i]
        const form = new FormData()
        form.append('file', file)

        let res = await fetch('/api/uploads', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        })

        if (res.status === 401) {
          const refreshed = await refreshToken()
          if (!refreshed) return
          token = localStorage.getItem('accessToken')
          res = await fetch('/api/uploads', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          })
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || 'Upload failed')
        }

        const data = await res.json()
        newAttachments.push({ url: data.url, filename: data.filename, mimeType: data.mimeType })
      }

      setAttachments((prev) => [...prev, ...newAttachments])
    } catch (e: any) {
      alert(e?.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleCreateConversation = async () => {
    if (!newConversationTo.trim()) {
      alert('Please enter a phone number or select a client')
      return
    }

    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
      }

      let response = await fetch('/api/messages/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          channel: newConversationChannel,
          to: newConversationTo,
        }),
      })

      if (response.status === 401) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
        response = await fetch('/api/messages/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            channel: newConversationChannel,
            to: newConversationTo,
          }),
        })
      }

      if (response.ok) {
        const data = await response.json()
        setSelectedConversation(data.conversation)
        setShowNewConversation(false)
        setNewConversationTo('')
        setNewConversationClientId('none')
        fetchConversations()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to create conversation')
      }
    } catch (error) {
      console.error('Failed to create conversation:', error)
      alert('Failed to create conversation')
    }
  }

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'SMS':
      case 'MMS':
        return <Phone className="h-4 w-4" />
      case 'WHATSAPP':
        return <MessageSquare className="h-4 w-4" />
      case 'EMAIL':
        return <Mail className="h-4 w-4" />
      default:
        return <MessageSquare className="h-4 w-4" />
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'DELIVERED':
        return <CheckCheck className="h-3 w-3 text-blue-500" />
      case 'READ':
        return <CheckCheck className="h-3 w-3 text-green-500" />
      case 'SENT':
        return <Check className="h-3 w-3 text-gray-400" />
      case 'FAILED':
        return <AlertCircle className="h-3 w-3 text-red-500" />
      default:
        return null
    }
  }

  const formatTime = (dateString: string | null) => {
    if (!dateString) return ''
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true })
    } catch {
      return ''
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left Panel - Conversation List */}
      <div className="w-80 border-r bg-gray-50 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-white">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Messages</h2>
            <Button size="sm" onClick={() => setShowNewConversation(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search conversations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <Select value={filterChannel} onValueChange={setFilterChannel}>
              <SelectTrigger className="flex-1 h-8 text-xs">
                <SelectValue placeholder="Channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="SMS">SMS</SelectItem>
                <SelectItem value="MMS">MMS</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="flex-1 h-8 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <MessageSquare className="h-12 w-12 mx-auto mb-2 text-gray-300" />
              <p>No conversations found</p>
              <Button
                variant="link"
                size="sm"
                className="mt-2"
                onClick={() => setShowNewConversation(true)}
              >
                Start a conversation
              </Button>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setSelectedConversation(conv as ConversationDetail)}
                className={`p-4 border-b cursor-pointer hover:bg-white transition-colors ${
                  selectedConversation?.id === conv.id ? 'bg-white border-l-4 border-l-blue-500' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getChannelIcon(conv.channel)}
                      <span className="font-semibold text-sm truncate">
                        {conv.client?.name || conv.participants[0] || 'Unknown'}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="ml-auto bg-blue-500 text-white text-xs rounded-full px-2 py-0.5">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {conv.messages?.[0]?.body || 'No messages yet'}
                    </p>
                  </div>
                </div>
                {conv.lastMessageAt && (
                  <p className="text-xs text-gray-400 mt-1">
                    {formatTime(conv.lastMessageAt)}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel - Thread View */}
      <div className="flex-1 flex flex-col">
        {selectedConversation ? (
          <>
            {/* Thread Header */}
            <div className="p-4 border-b bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {getChannelIcon(selectedConversation.channel)}
                    <h3 className="font-semibold">
                      {selectedConversation.client?.name || selectedConversation.participants[0] || 'Unknown'}
                    </h3>
                  </div>
                  {selectedConversation.client && (
                    <p className="text-sm text-gray-500">
                      {selectedConversation.client.phone || selectedConversation.client.email}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedConversation.client && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/dashboard/clients/${selectedConversation.client!.id}`)}
                    >
                      View Client
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {selectedConversation.messages?.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg p-3 ${
                      message.direction === 'OUTBOUND'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-900'
                    }`}
                  >
                    {message.body && <p className="text-sm whitespace-pre-wrap">{message.body}</p>}
                    
                    {/* Media */}
                    {message.media && message.media.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {message.media.map((media) => (
                          <div key={media.id}>
                            {media.type === 'image' ? (
                              <img
                                src={media.url}
                                alt={media.filename || 'Image'}
                                className="max-w-full rounded"
                                style={{ maxHeight: '200px' }}
                                onLoad={() => console.log('Image loaded successfully:', media.url)}
                                onError={(e) => {
                                  console.error('Image load error for URL:', media.url)
                                  console.error('Image load error details:', {
                                    url: media.url,
                                    filename: media.filename,
                                    type: media.type,
                                    error: e,
                                    targetSrc: (e.target as HTMLImageElement).src,
                                  })
                                  // Try to load using relative URL if absolute fails
                                  if (media.url && media.url.startsWith('https://')) {
                                    const relativeUrl = media.url.replace(/^https?:\/\/[^\/]+/, '')
                                    console.log('Trying relative URL:', relativeUrl)
                                    ;(e.target as HTMLImageElement).src = relativeUrl
                                  } else {
                                    e.currentTarget.style.display = 'none'
                                  }
                                }}
                              />
                            ) : (
                              <a
                                href={media.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-sm underline"
                              >
                                <Paperclip className="h-4 w-4" />
                                {media.filename || 'Attachment'}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : message.body && message.body.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                      // Fallback: if body looks like a filename, try to load it as an image
                      <div className="mt-2">
                        <img
                          src={`/uploads/${selectedConversation.tenantId || ''}/${message.body}`}
                          alt={message.body}
                          className="max-w-full rounded"
                          style={{ maxHeight: '200px' }}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      </div>
                    ) : null}

                    {/* Status and Time */}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs opacity-70">
                        {formatTime(message.createdAt)}
                      </span>
                      {message.direction === 'OUTBOUND' && (
                        <span className="ml-auto">{getStatusIcon(message.status)}</span>
                      )}
                    </div>

                    {message.errorMessage && (
                      <p className="text-xs text-red-200 mt-1">{message.errorMessage}</p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Compose Box */}
            <div className="p-4 border-t bg-white">
              {/* Attachments preview */}
              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {attachments.map((a) => (
                    <div key={a.url} className="relative">
                      <img
                        src={a.url}
                        alt={a.filename || 'Attachment'}
                        className="h-16 w-16 rounded object-cover border"
                      />
                      <button
                        type="button"
                        className="absolute -top-2 -right-2 bg-white border rounded-full p-1 shadow"
                        onClick={() => setAttachments((prev) => prev.filter((x) => x.url !== a.url))}
                        aria-label="Remove attachment"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 items-start">
                <div className="flex flex-col gap-2 pt-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => uploadFiles(e.target.files)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title="Attach photo"
                  >
                    <ImageIcon className="h-4 w-4" />
                  </Button>

                  <div className="relative" ref={emojiRef}>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setShowEmoji((s) => !s)}
                      title="Emoji"
                    >
                      <span className="text-lg leading-none">😊</span>
                    </Button>
                    {showEmoji && (
                      <div className="absolute bottom-12 left-0 z-50 w-64 rounded-md border bg-white shadow p-2">
                        <div className="grid grid-cols-8 gap-1 text-lg">
                          {['😀','😁','😂','🤣','😊','😍','😘','😎','😅','👍','🙏','🔥','💯','🎉','📞','📸','✅','❗','❤️','🤝','👀','🙌','😡','😢','🤔','👏','🫡','🚗','📍','🧾','💵','🛠️'].map((em) => (
                            <button
                              key={em}
                              type="button"
                              className="hover:bg-gray-100 rounded p-1"
                              onClick={() => insertEmoji(em)}
                            >
                              {em}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          Tip: Windows emoji picker is <span className="font-mono">Win + .</span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <Textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                  placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                  className="min-h-[60px] resize-none"
                  rows={2}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={((!messageText.trim() && attachments.length === 0) || sending || uploading)}
                  title={uploading ? 'Uploading...' : 'Send'}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {selectedConversation.channel === 'SMS' && `${messageText.length} characters`}
                {uploading && ' • Uploading...'}
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <MessageSquare className="h-16 w-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">Select a conversation to start messaging</p>
            </div>
          </div>
        )}
      </div>

      {/* New Conversation Dialog */}
      <Dialog open={showNewConversation} onOpenChange={setShowNewConversation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start New Conversation</DialogTitle>
            <DialogDescription>Create a new conversation with a client or phone number</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Channel</label>
              <Select value={newConversationChannel} onValueChange={(v: any) => setNewConversationChannel(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SMS">SMS</SelectItem>
                  <SelectItem value="MMS">MMS</SelectItem>
                  <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Client (Optional)</label>
              <Select
                value={newConversationClientId}
                onValueChange={(clientId) => {
                  setNewConversationClientId(clientId)
                  if (clientId === 'none') return
                  const client = clients.find((c) => c.id === clientId)
                  if (client && client.phone) {
                    setNewConversationTo(client.phone)
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {clients
                    .filter((c) => c.phone)
                    .map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name} - {client.phone}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Phone Number</label>
              <Input
                value={newConversationTo}
                onChange={(e) => setNewConversationTo(e.target.value)}
                placeholder="+15551234567"
                type="tel"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowNewConversation(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateConversation} disabled={!newConversationTo.trim()}>
                Start Conversation
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
