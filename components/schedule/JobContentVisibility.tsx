'use client'

import { useEffect, useState } from 'react'

export type JobVisibilityValue = {
  restrictContent: boolean
  attachmentIds: string[]
  noteIds: string[]
}

type ShareAttachment = { id: string; fileName: string; fileSize: number; mimeType: string }
type ShareNote = { id: string; content: string; isJobDescription: boolean; scheduleId?: string | null }

function formatBytes(bytes: number) {
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

/**
 * "What can this person see on the job?" — choose the attachments and notes shared
 * with the scheduled person. Renders nothing unless a job is chosen and the user
 * has permission (the parent gets `null` in that case and sends no visibility fields).
 *
 * `initial` pre-fills the choice when editing an existing schedule.
 */
export function JobContentVisibility({
  jobId,
  value,
  onChange,
  initial,
}: {
  jobId: string
  value: JobVisibilityValue | null
  onChange: (next: JobVisibilityValue | null) => void
  initial?: JobVisibilityValue
}) {
  const [attachments, setAttachments] = useState<ShareAttachment[]>([])
  const [notes, setNotes] = useState<ShareNote[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!jobId) {
      onChange(null)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const res = await fetch(`/api/jobs/${jobId}/share-options`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          if (!cancelled) onChange(null) // no permission, or job not found
          return
        }
        const data = await res.json()
        if (cancelled) return
        const a: ShareAttachment[] = data.attachments || []
        const n: ShareNote[] = data.notes || []
        setAttachments(a)
        setNotes(n)
        onChange(initial ?? { restrictContent: true, attachmentIds: [], noteIds: [] })
      } catch {
        if (!cancelled) onChange(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  if (!jobId || (!value && !loading)) return null
  if (loading || !value) return <p className="text-sm text-gray-500">Loading what can be shared…</p>

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  return (
    <div className="space-y-3 rounded-md border border-gray-200 p-4">
      <div>
        <p className="text-sm font-semibold text-gray-800">What can this person see on the job?</p>
        <p className="text-xs text-gray-500">Applies when they open the job from their schedule.</p>
      </div>

      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={!value.restrictContent}
            onChange={() => onChange({ ...value, restrictContent: false })}
          />
          Everything on the job
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={value.restrictContent}
            onChange={() => onChange({ ...value, restrictContent: true })}
          />
          Only what I select below
        </label>
      </div>

      {value.restrictContent && (
        <>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</p>
            <p className="mb-1 text-xs text-gray-500">
              The schedule description is added to the job notes and shared with this person automatically.
            </p>
            {notes.length === 0 ? (
              <p className="text-sm text-gray-500">This job has no notes.</p>
            ) : (
              <div className="space-y-1">
                {notes.map((n) => (
                  <label key={n.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={value.noteIds.includes(n.id) || Boolean(n.scheduleId)}
                      disabled={Boolean(n.scheduleId)}
                      onChange={() => onChange({ ...value, noteIds: toggle(value.noteIds, n.id) })}
                    />
                    <span className="min-w-0">
                      {n.isJobDescription && <span className="mr-1 font-medium text-gray-700">Job description:</span>}
                      {n.scheduleId && <span className="mr-1 font-medium text-gray-700">Schedule note (always shared):</span>}
                      <span className="line-clamp-2 break-words text-gray-600">{n.content}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Attachments</p>
              {attachments.length > 0 && (
                <span className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-blue-600 hover:underline"
                    onClick={() => onChange({ ...value, attachmentIds: attachments.map((a) => a.id) })}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-gray-500 hover:underline"
                    onClick={() => onChange({ ...value, attachmentIds: [] })}
                  >
                    None
                  </button>
                </span>
              )}
            </div>
            {attachments.length === 0 ? (
              <p className="text-sm text-gray-500">This job has no attachments.</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {attachments.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={value.attachmentIds.includes(a.id)}
                      onChange={() => onChange({ ...value, attachmentIds: toggle(value.attachmentIds, a.id) })}
                    />
                    <span className="min-w-0 flex-1 truncate text-gray-800">{a.fileName}</span>
                    <span className="shrink-0 text-xs text-gray-400">{formatBytes(a.fileSize)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
