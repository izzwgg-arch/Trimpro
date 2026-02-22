'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Paperclip, Upload, Trash2, ExternalLink } from 'lucide-react'
import { useRef } from 'react'

type EntityType = 'estimate' | 'invoice' | 'job'

interface Attachment {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  url: string
  createdAt: string
}

interface Props {
  entityType: EntityType
  entityId: string
}

function normalizePublicUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl, window.location.origin)
    const host = parsed.hostname
    const isInternalHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
    if (isInternalHost) {
      return `https://app.trimprony.com${parsed.pathname}${parsed.search}`
    }
    return parsed.toString()
  } catch {
    if (rawUrl.startsWith('/')) return `https://app.trimprony.com${rawUrl}`
    return rawUrl
  }
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function DocumentAttachments({ entityType, entityId }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/attachments?entityType=${entityType}&entityId=${entityId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        setAttachments(data.attachments || [])
      }
    } catch (error) {
      console.error('Failed to load attachments:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (entityId) load()
  }, [entityType, entityId])

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        alert('Please sign in again and retry upload.')
        return
      }
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const upRes = await fetch('/api/uploads', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        })
        const upData = await upRes.json()
        if (!upRes.ok) {
          alert(upData.error || `Upload failed for ${file.name}`)
          continue
        }

        const createRes = await fetch('/api/attachments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            entityType,
            entityId,
            fileName: file.name,
            fileSize: upData.size || file.size,
            mimeType: upData.mimeType || file.type || 'application/octet-stream',
            url: upData.url,
            key: upData.relativeUrl || upData.filename || upData.url,
          }),
        })
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({}))
          alert(err.error || `Failed to attach ${file.name}`)
        }
      }
      await load()
    } catch (error) {
      console.error('Upload attachments error:', error)
      alert('Failed to upload files')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
      setUploading(false)
    }
  }

  const deleteAttachment = async (id: string) => {
    if (!confirm('Delete this attachment?')) return
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/attachments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to delete attachment')
        return
      }
      setAttachments((prev) => prev.filter((a) => a.id !== id))
    } catch (error) {
      console.error('Delete attachment error:', error)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium">
          <Paperclip className="h-4 w-4" />
          Attachments
        </div>
        <label className="cursor-pointer">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => uploadFiles(e.target.files)}
            accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading attachments...</p>
      ) : attachments.length === 0 ? (
        <p className="text-sm text-gray-500">No files uploaded yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {attachments.map((a) => (
            <div key={a.id} className="rounded border p-2">
              {a.mimeType.startsWith('image/') && (
                <img
                  src={normalizePublicUrl(a.url)}
                  alt={a.fileName}
                  className="mb-2 h-24 w-24 rounded object-cover border cursor-pointer hover:opacity-80"
                  onClick={() => window.open(normalizePublicUrl(a.url), '_blank')}
                />
              )}
              {a.mimeType.startsWith('video/') && (
                <div className="mb-2 h-24 w-24 rounded border bg-black flex items-center justify-center cursor-pointer hover:opacity-80" onClick={() => window.open(normalizePublicUrl(a.url), '_blank')}>
                  <svg className="h-8 w-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                  </svg>
                </div>
              )}
              {!a.mimeType.startsWith('image/') && !a.mimeType.startsWith('video/') && (
                <div className="mb-2 h-24 w-24 rounded border bg-gray-100 flex items-center justify-center">
                  <Paperclip className="h-8 w-8 text-gray-400" />
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{a.fileName}</div>
                  <div className="text-xs text-gray-500">{formatBytes(a.fileSize)}</div>
                </div>
                <div className="flex items-center gap-1 ml-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => window.open(normalizePublicUrl(a.url), '_blank')}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => deleteAttachment(a.id)}>
                    <Trash2 className="h-3 w-3 text-red-600" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
