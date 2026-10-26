'use client'

import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authFetch } from '@/lib/auth/client'
import { formatDateTime } from '@/lib/utils'

type Work = {
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED'
  startedAt: string | null
  finishedAt: string | null
  completionNotes: string | null
  activeSeconds: number
  segments: Array<{ startedAt: string | null; endedAt: string | null }>
}

export const WORK_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
}
export const WORK_STATUS_CLASS: Record<string, string> = {
  NOT_STARTED: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-green-100 text-green-800',
  PAUSED: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-blue-100 text-blue-800',
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`
}

/** The scheduled person's work on this visit, for the site manager. */
export function ScheduleWorkProgress({ scheduleId }: { scheduleId: string }) {
  const [work, setWork] = useState<Work | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const res = await authFetch(`/api/schedules/${scheduleId}/details`)
      if (!res.ok) return
      const data = await res.json()
      if (!cancelled) setWork(data.work || null)
    }
    void load()
    const t = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [scheduleId])

  if (!work) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Timer className="h-5 w-5" />
          Work Progress
        </CardTitle>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${WORK_STATUS_CLASS[work.status]}`}>
          {WORK_STATUS_LABEL[work.status]}
        </span>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {work.status === 'NOT_STARTED' ? <p className="text-gray-500">The worker has not started yet.</p> : null}
        {work.status !== 'NOT_STARTED' ? (
          <p>
            <span className="font-medium">Active time:</span> {clock(work.activeSeconds)} <span className="text-gray-500">(pauses not counted)</span>
          </p>
        ) : null}
        {work.startedAt ? (
          <p>
            <span className="font-medium">Started:</span> {formatDateTime(work.startedAt)}
          </p>
        ) : null}
        {work.finishedAt ? (
          <p>
            <span className="font-medium">Finished:</span> {formatDateTime(work.finishedAt)}
          </p>
        ) : null}
        {work.completionNotes ? (
          <div className="rounded-md bg-blue-50 p-3">
            <p className="text-xs font-semibold uppercase text-blue-800">Completion notes</p>
            <p className="whitespace-pre-wrap text-gray-800">{work.completionNotes}</p>
          </div>
        ) : null}
        {work.segments.length > 1 ? (
          <details>
            <summary className="cursor-pointer text-gray-600">{work.segments.length} work periods</summary>
            <ul className="mt-1 space-y-0.5 text-gray-600">
              {work.segments.map((s, i) => (
                <li key={i}>
                  {s.startedAt ? formatDateTime(s.startedAt) : '?'} – {s.endedAt ? formatDateTime(s.endedAt) : 'now'}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  )
}
