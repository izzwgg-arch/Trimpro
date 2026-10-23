import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/authorization'

export const SET_CONTENT_VISIBILITY_PERMISSION = 'schedule.set_content_visibility'

// Schedules made automatically from a job's crew (lib/services/job-schedule-sync.ts)
// carry this marker; they never limit what someone can see.
const AUTO_SCHEDULE_MARKER = '[AUTO_JOB_SCHEDULE]'

export type JobContentScope =
  | { restricted: false }
  | { restricted: true; attachmentIds: Set<string>; noteIds: Set<string> }

/**
 * What a person may see when they open a job.
 *
 * The schedule that governs is the one they are on right now; otherwise their next one
 * coming up (so a note and photos picked for a visit are there as soon as it is
 * scheduled); otherwise their most recent one. So what was chosen on a schedule applies
 * until their next schedule on the job takes over. If that schedule
 * limits them, they see only the attachments and notes chosen on it (plus the note made
 * from its own description). Only attachments and notes are ever limited; everything
 * else comes from the person's permissions.
 *
 * When the job is opened from one of their schedules (`scheduleId`), that schedule governs.
 */
/** The person's hand-made schedule on this job that governs what they see (see below), or null. */
export async function findGoverningSchedule(userId: string, jobId: string, scheduleId?: string | null) {
  const rows = await prisma.schedule.findMany({
    where: { jobId, userId },
    select: { id: true, description: true, startTime: true, endTime: true, restrictContent: true, visibleAttachmentIds: true, visibleNoteIds: true },
  })
  const now = Date.now()
  const handMade = rows
    .filter((r) => !String(r.description || '').startsWith(AUTO_SCHEDULE_MARKER))
    .sort((x, y) => x.startTime.getTime() - y.startTime.getTime())
  const inProgress = handMade.filter((r) => r.startTime.getTime() <= now && r.endTime.getTime() >= now)
  const upcoming = handMade.filter((r) => r.startTime.getTime() > now)
  const opened = scheduleId ? handMade.find((r) => r.id === scheduleId) : undefined
  const governing = opened
    ? opened
    : inProgress.length > 0
      ? inProgress[inProgress.length - 1]
      : upcoming.length > 0
        ? upcoming[0]
        : handMade[handMade.length - 1]
  return governing ?? null
}

export async function resolveJobContentScope(
  userId: string,
  jobId: string,
  scheduleId?: string | null
): Promise<JobContentScope> {
  const governing = await findGoverningSchedule(userId, jobId, scheduleId)
  const limiting = governing && governing.restrictContent ? [governing] : []
  if (limiting.length === 0) return { restricted: false }

  const attachmentIds = new Set<string>()
  const noteIds = new Set<string>()
  for (const r of limiting) {
    r.visibleAttachmentIds.forEach((id) => attachmentIds.add(id))
    r.visibleNoteIds.forEach((id) => noteIds.add(id))
  }
  const ownNotes = await prisma.note.findMany({
    where: { jobId, scheduleId: { in: limiting.map((r) => r.id) } },
    select: { id: true },
  })
  ownNotes.forEach((n) => noteIds.add(n.id))
  return { restricted: true, attachmentIds, noteIds }
}

export async function canSetContentVisibility(user: { id: string; tenantId: string; role: string }) {
  if (user.role === 'ADMIN') return true
  return hasPermission(user.id, user.tenantId, SET_CONTENT_VISIBILITY_PERMISSION)
}

export type VisibilityInput = {
  /** True when the request says anything about visibility. */
  provided: boolean
  restrictContent: boolean
  attachmentIds: string[]
  noteIds: string[]
}

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? Array.from(new Set(value.map((v) => String(v)).filter(Boolean))) : []

export function parseVisibilityInput(body: any): VisibilityInput {
  const provided =
    body?.restrictContent !== undefined ||
    body?.visibleAttachmentIds !== undefined ||
    body?.visibleNoteIds !== undefined
  return {
    provided,
    restrictContent: Boolean(body?.restrictContent),
    attachmentIds: ids(body?.visibleAttachmentIds),
    noteIds: ids(body?.visibleNoteIds),
  }
}

/**
 * Keep only attachments/notes that really belong to the job.
 */
export async function cleanVisibilityForJob(jobId: string, input: VisibilityInput) {
  const [attachments, notes] = await Promise.all([
    input.attachmentIds.length
      ? prisma.attachment.findMany({ where: { id: { in: input.attachmentIds }, jobId }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
    input.noteIds.length
      ? prisma.note.findMany({ where: { id: { in: input.noteIds }, jobId }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
  ])
  return {
    attachmentIds: attachments.map((a) => a.id),
    noteIds: notes.map((n) => n.id),
  }
}
