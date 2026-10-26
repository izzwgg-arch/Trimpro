/**
 * A scheduled person's work on one visit: Start → (Pause ↔ Resume)* → Finish.
 *
 * Each Start/Resume opens a time entry linked to the schedule; each Pause/Finish
 * closes it, so paused time is never counted. Times always come from the server.
 * The work status is separate from the job status and never changes it.
 */
import type { Prisma } from '@prisma/client'

export type WorkStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED'
export type WorkAction = 'start' | 'pause' | 'resume' | 'finish'

export const WORK_ACTIONS: WorkAction[] = ['start', 'pause', 'resume', 'finish']

type Segment = { startedAt: Date | null; endedAt: Date | null; status: string; createdAt?: Date }

export type WorkSummary = {
  status: WorkStatus
  startedAt: string | null
  finishedAt: string | null
  completionNotes: string | null
  /** Active work so far, in seconds (paused time excluded). */
  activeSeconds: number
  /** When the running segment started (only while In progress) — clients count up from here. */
  runningSince: string | null
  segments: Array<{ startedAt: string | null; endedAt: string | null }>
  serverTime: string
}

export function summarizeWork(
  schedule: { workStatus: string; workStartedAt: Date | null; workFinishedAt: Date | null; completionNotes: string | null },
  entries: Segment[],
  now: Date = new Date()
): WorkSummary {
  let activeMs = 0
  let runningSince: Date | null = null
  const sorted = [...entries].sort(
    (a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0)
  )
  for (const e of sorted) {
    const start = e.startedAt ?? e.createdAt ?? null
    if (!start) continue
    if (e.status === 'ACTIVE' && !e.endedAt) {
      runningSince = start
      activeMs += Math.max(0, now.getTime() - start.getTime())
    } else if (e.endedAt) {
      activeMs += Math.max(0, e.endedAt.getTime() - start.getTime())
    }
  }
  const status = schedule.workStatus as WorkStatus
  return {
    status,
    startedAt: schedule.workStartedAt?.toISOString() ?? null,
    finishedAt: schedule.workFinishedAt?.toISOString() ?? null,
    completionNotes: schedule.completionNotes ?? null,
    activeSeconds: Math.round(activeMs / 1000),
    runningSince: status === 'IN_PROGRESS' && runningSince ? runningSince.toISOString() : null,
    segments: sorted.map((e) => ({ startedAt: e.startedAt?.toISOString() ?? null, endedAt: e.endedAt?.toISOString() ?? null })),
    serverTime: now.toISOString(),
  }
}

/**
 * What an action does from a given status. 'noop' = already there (a retried request),
 * so nothing changes and the current state is returned.
 */
export function planWorkAction(
  status: WorkStatus,
  action: WorkAction
): { kind: 'open' | 'close' | 'finish' | 'noop' } | { kind: 'error'; message: string } {
  if (status === 'COMPLETED') {
    return action === 'finish' ? { kind: 'noop' } : { kind: 'error', message: 'This visit is already finished.' }
  }
  switch (action) {
    case 'start':
      if (status === 'NOT_STARTED' || status === 'PAUSED') return { kind: 'open' }
      return { kind: 'noop' }
    case 'resume':
      if (status === 'PAUSED') return { kind: 'open' }
      if (status === 'IN_PROGRESS') return { kind: 'noop' }
      return { kind: 'error', message: 'Start the job first.' }
    case 'pause':
      if (status === 'IN_PROGRESS') return { kind: 'close' }
      if (status === 'PAUSED') return { kind: 'noop' }
      return { kind: 'error', message: 'The job has not been started.' }
    case 'finish':
      if (status === 'IN_PROGRESS' || status === 'PAUSED') return { kind: 'finish' }
      return { kind: 'error', message: 'Start the job before finishing it.' }
  }
}

export const minutesBetween = (start: Date, end: Date) =>
  Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))

export type Tx = Prisma.TransactionClient
