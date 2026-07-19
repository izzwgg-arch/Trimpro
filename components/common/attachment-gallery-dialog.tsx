'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  ExternalLink,
  FileText,
  Film,
  Minus,
  Music,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
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

type Point = { x: number; y: number }
type Stroke = { color: string; width: number; points: Point[] }

const MARKUP_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#111827']

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

function ImageMarkupViewer({
  src,
  fileName,
  active,
}: {
  src: string
  fileName: string
  active: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [tool, setTool] = useState<'pan' | 'draw'>('pan')
  const [color, setColor] = useState(MARKUP_COLORS[0])
  const [brush, setBrush] = useState(4)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [drawing, setDrawing] = useState(false)
  const [panning, setPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 })
  const strokesRef = useRef<Stroke[]>([])

  useEffect(() => {
    strokesRef.current = strokes
  }, [strokes])

  useEffect(() => {
    if (!active) return
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setStrokes([])
    setTool('pan')
    setDrawing(false)
    setPanning(false)
  }, [src, active])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    const container = containerRef.current
    if (!canvas || !image || !container || !image.complete) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const naturalW = image.naturalWidth || 1
    const naturalH = image.naturalHeight || 1
    const fit = Math.min(rect.width / naturalW, rect.height / naturalH)
    const drawW = naturalW * fit * zoom
    const drawH = naturalH * fit * zoom
    const x = (rect.width - drawW) / 2 + offset.x
    const y = (rect.height - drawH) / 2 + offset.y

    ctx.drawImage(image, x, y, drawW, drawH)

    for (const stroke of strokesRef.current) {
      if (stroke.points.length < 2) continue
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width * zoom
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const first = stroke.points[0]
      ctx.moveTo(x + first.x * fit * zoom, y + first.y * fit * zoom)
      for (let i = 1; i < stroke.points.length; i += 1) {
        const point = stroke.points[i]
        ctx.lineTo(x + point.x * fit * zoom, y + point.y * fit * zoom)
      }
      ctx.stroke()
    }
  }, [offset.x, offset.y, zoom])

  useEffect(() => {
    redraw()
  }, [redraw, strokes])

  useEffect(() => {
    if (!active) return
    const onResize = () => redraw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [active, redraw])

  const getImageSpacePoint = (clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current
    const image = imageRef.current
    const container = containerRef.current
    if (!canvas || !image || !container) return null
    const rect = container.getBoundingClientRect()
    const naturalW = image.naturalWidth || 1
    const naturalH = image.naturalHeight || 1
    const fit = Math.min(rect.width / naturalW, rect.height / naturalH)
    const drawW = naturalW * fit * zoom
    const drawH = naturalH * fit * zoom
    const x = (rect.width - drawW) / 2 + offset.x
    const y = (rect.height - drawH) / 2 + offset.y
    const localX = clientX - rect.left
    const localY = clientY - rect.top
    return {
      x: (localX - x) / (fit * zoom),
      y: (localY - y) / (fit * zoom),
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    canvasRef.current?.setPointerCapture(event.pointerId)
    if (tool === 'draw') {
      const point = getImageSpacePoint(event.clientX, event.clientY)
      if (!point) return
      setDrawing(true)
      setStrokes((prev) => [...prev, { color, width: brush, points: [point] }])
      return
    }
    setPanning(true)
    panStart.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawing && tool === 'draw') {
      const point = getImageSpacePoint(event.clientX, event.clientY)
      if (!point) return
      setStrokes((prev) => {
        if (prev.length === 0) return prev
        const next = [...prev]
        const last = { ...next[next.length - 1], points: [...next[next.length - 1].points, point] }
        next[next.length - 1] = last
        return next
      })
      return
    }
    if (panning && tool === 'pan') {
      setOffset({
        x: panStart.current.ox + (event.clientX - panStart.current.x),
        y: panStart.current.oy + (event.clientY - panStart.current.y),
      })
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      canvasRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    setDrawing(false)
    setPanning(false)
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.12 : 0.12
    setZoom((prev) => Math.min(5, Math.max(0.4, Number((prev + delta).toFixed(2)))))
  }

  const downloadMarked = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    const base = fileName.replace(/\.[^.]+$/, '') || 'attachment'
    link.download = `${base}-marked.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 bg-white/10 text-white hover:bg-white/20"
          onClick={() => setZoom((z) => Math.min(5, Number((z + 0.25).toFixed(2))))}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 bg-white/10 text-white hover:bg-white/20"
          onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.25).toFixed(2))))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="min-w-[3.5rem] text-center text-xs text-zinc-300">{Math.round(zoom * 100)}%</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 bg-white/10 text-white hover:bg-white/20"
          onClick={() => {
            setZoom(1)
            setOffset({ x: 0, y: 0 })
          }}
          title="Reset zoom"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>

        <div className="mx-1 h-5 w-px bg-white/15" />

        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={`h-8 ${tool === 'pan' ? 'bg-white text-zinc-900 hover:bg-zinc-100' : 'bg-white/10 text-white hover:bg-white/20'}`}
          onClick={() => setTool('pan')}
          title="Pan / move"
        >
          Move
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={`h-8 ${tool === 'draw' ? 'bg-white text-zinc-900 hover:bg-zinc-100' : 'bg-white/10 text-white hover:bg-white/20'}`}
          onClick={() => setTool('draw')}
          title="Draw markup"
        >
          <Pencil className="mr-1 h-4 w-4" />
          Markup
        </Button>

        {tool === 'draw' && (
          <>
            <div className="flex items-center gap-1">
              {MARKUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-full border ${color === c ? 'border-white ring-2 ring-white/50' : 'border-white/30'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              Size
              <input
                type="range"
                min={2}
                max={16}
                value={brush}
                onChange={(e) => setBrush(Number(e.target.value))}
                className="w-20"
              />
            </label>
          </>
        )}

        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 bg-white/10 text-white hover:bg-white/20"
          disabled={strokes.length === 0}
          onClick={() => setStrokes((prev) => prev.slice(0, -1))}
          title="Undo last mark"
        >
          <Eraser className="mr-1 h-4 w-4" />
          Undo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 bg-white/10 text-white hover:bg-white/20"
          disabled={strokes.length === 0}
          onClick={() => setStrokes([])}
          title="Clear markup"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 bg-white/10 text-white hover:bg-white/20"
          onClick={downloadMarked}
          title="Download image with markup"
        >
          <Download className="mr-1 h-4 w-4" />
          Save
        </Button>
      </div>

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-black"
        onWheel={onWheel}
      >
        {/* Hidden image used as the drawing source */}
        <img
          ref={imageRef}
          src={src}
          alt={fileName}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          onLoad={redraw}
        />
        <canvas
          ref={canvasRef}
          className={`h-full w-full touch-none ${tool === 'draw' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  )
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
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
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
      <DialogContent className="max-w-[min(99vw,1500px)] w-[min(99vw,1500px)] h-[min(96dvh,1040px)] gap-0 overflow-hidden border-0 bg-zinc-950 p-0 text-white sm:rounded-xl max-sm:h-[96dvh]">
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
                className="absolute left-2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 sm:left-3"
                onClick={goPrev}
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
            )}

            <div className={`flex h-full w-full items-center justify-center ${kind === 'image' ? '' : 'p-4 sm:px-16'}`}>
              {!current ? (
                <p className="text-sm text-zinc-400">No attachments</p>
              ) : kind === 'image' ? (
                <ImageMarkupViewer key={current.id} src={url} fileName={current.fileName} active={open} />
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
                className="absolute right-2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 sm:right-3"
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
