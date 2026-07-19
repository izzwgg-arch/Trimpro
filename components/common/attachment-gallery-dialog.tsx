'use client'

import { useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Film,
  Music,
  Paperclip,
} from 'lucide-react'

export type GalleryAttachment = {
  id: string
  fileName: string
  fileSize?: number
  mimeType: string
  url: string
}

type Props = {
  open: boolean
  attachments: GalleryAttachment[]
  index: number
  onOpenChange: (open: boolean) => void
  onIndexChange: (index: number) => void
}

function normalizePublicUrl(rawUrl: string) {
  try {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://app.trimprony.com'
    const parsed = new URL(rawUrl, origin)
    const host = parsed.hostname
    const isInternalHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host)

    const browsingLocally =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        /^\d{1,3}(\.\d{1,3}){3}$/.test(window.location.hostname))

    if (isInternalHost) {
      if (browsingLocally) {
        return `${window.location.origin}${parsed.pathname}${parsed.search}`
      }
      return `https://app.trimprony.com${parsed.pathname}${parsed.search}`
    }
    return parsed.toString()
  } catch {
    if (rawUrl.startsWith('/')) {
      if (typeof window !== 'undefined') return `${window.location.origin}${rawUrl}`
      return `https://app.trimprony.com${rawUrl}`
    }
    return rawUrl
  }
}

function formatBytes(bytes?: number) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function getPreviewKind(mimeType: string, fileName: string) {
  const mime = (mimeType || '').toLowerCase()
  const name = (fileName || '').toLowerCase()
  if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name)) return 'image'
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi)$/i.test(name)) return 'video'
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return 'audio'
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  return 'other'
}

export function AttachmentGalleryDialog({
  open,
  attachments,
  index,
  onOpenChange,
  onIndexChange,
}: Props) {
  const total = attachments.length
  const safeIndex = total > 0 ? ((index % total) + total) % total : 0
  const current = total > 0 ? attachments[safeIndex] : null
  const url = current ? normalizePublicUrl(current.url) : ''
  const kind = current ? getPreviewKind(current.mimeType, current.fileName) : 'other'
  const canNavigate = total > 1

  const goPrev = useCallback(() => {
    if (!canNavigate) return
    onIndexChange((safeIndex - 1 + total) % total)
  }, [canNavigate, onIndexChange, safeIndex, total])

  const goNext = useCallback(() => {
    if (!canNavigate) return
    onIndexChange((safeIndex + 1) % total)
  }, [canNavigate, onIndexChange, safeIndex, total])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goPrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, goPrev, goNext])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,1100px)] w-[min(96vw,1100px)] h-[min(92dvh,900px)] gap-0 overflow-hidden border-0 bg-zinc-950 p-0 text-white sm:rounded-xl max-sm:h-[92dvh]">
        <DialogTitle className="sr-only">
          {current ? `Attachment ${current.fileName}` : 'Attachments gallery'}
        </DialogTitle>

        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 pr-14">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{current?.fileName || 'Attachment'}</p>
              <p className="text-xs text-zinc-400">
                {total > 0 ? `${safeIndex + 1} of ${total}` : '0 of 0'}
                {current?.fileSize ? ` · ${formatBytes(current.fileSize)}` : ''}
                {current?.mimeType ? ` · ${current.mimeType}` : ''}
              </p>
            </div>
            {current && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="shrink-0 bg-white/10 text-white hover:bg-white/20"
                onClick={() => window.open(url, '_blank')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open
              </Button>
            )}
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
            {canNavigate && (
              <button
                type="button"
                aria-label="Previous attachment"
                className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 sm:left-4"
                onClick={goPrev}
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
            )}

            <div className="flex h-full w-full items-center justify-center p-4 sm:px-16">
              {!current ? (
                <p className="text-sm text-zinc-400">No attachments</p>
              ) : kind === 'image' ? (
                <img
                  src={url}
                  alt={current.fileName}
                  className="max-h-full max-w-full object-contain"
                />
              ) : kind === 'video' ? (
                <video
                  key={current.id}
                  src={url}
                  controls
                  autoPlay
                  className="max-h-full max-w-full rounded"
                />
              ) : kind === 'audio' ? (
                <div className="flex w-full max-w-lg flex-col items-center gap-6 rounded-xl bg-zinc-900 px-6 py-10">
                  <Music className="h-14 w-14 text-zinc-300" />
                  <p className="text-center text-sm font-medium">{current.fileName}</p>
                  <audio key={current.id} src={url} controls autoPlay className="w-full" />
                </div>
              ) : kind === 'pdf' ? (
                <iframe
                  key={current.id}
                  src={url}
                  title={current.fileName}
                  className="h-full w-full rounded bg-white"
                />
              ) : (
                <div className="flex max-w-md flex-col items-center gap-4 rounded-xl bg-zinc-900 px-8 py-10 text-center">
                  {current.mimeType.includes('sheet') || current.fileName.match(/\.(xls|xlsx|csv)$/i) ? (
                    <FileText className="h-14 w-14 text-zinc-300" />
                  ) : current.mimeType.startsWith('video/') ? (
                    <Film className="h-14 w-14 text-zinc-300" />
                  ) : (
                    <Paperclip className="h-14 w-14 text-zinc-300" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{current.fileName}</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      Preview not available for this file type. Use Open to view or download.
                    </p>
                  </div>
                  <Button
                    type="button"
                    className="bg-white text-zinc-900 hover:bg-zinc-100"
                    onClick={() => window.open(url, '_blank')}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open file
                  </Button>
                </div>
              )}
            </div>

            {canNavigate && (
              <button
                type="button"
                aria-label="Next attachment"
                className="absolute right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 sm:right-4"
                onClick={goNext}
              >
                <ChevronRight className="h-7 w-7" />
              </button>
            )}
          </div>

          {total > 1 && (
            <div className="flex gap-2 overflow-x-auto border-t border-white/10 px-3 py-2">
              {attachments.map((item, itemIndex) => {
                const thumbUrl = normalizePublicUrl(item.url)
                const thumbKind = getPreviewKind(item.mimeType, item.fileName)
                const active = itemIndex === safeIndex
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.fileName}
                    onClick={() => onIndexChange(itemIndex)}
                    className={`h-14 w-14 shrink-0 overflow-hidden rounded border ${
                      active ? 'border-white ring-2 ring-white/40' : 'border-white/20 opacity-70 hover:opacity-100'
                    }`}
                  >
                    {thumbKind === 'image' ? (
                      <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-[10px] font-semibold uppercase text-zinc-300">
                        {thumbKind === 'pdf'
                          ? 'PDF'
                          : thumbKind === 'video'
                            ? 'VID'
                            : thumbKind === 'audio'
                              ? 'AUD'
                              : 'FILE'}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
