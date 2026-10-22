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
 * Unrestricted unless they have a schedule on this job that was created by hand
 * with "limit what they see" switched on. Then they see only the attachments and
 * notes chosen on those limiting schedule(s) (plus the notes made from those schedules'
 * own descriptions). Only attachments and notes are ever limited; everything else comes
 * from the person's permissions. A limiting schedule always wins: adding another, unlimited schedule for the
 * same job does not lift the limit (edit or delete the limiting one instead).
 */
export async function resolveJobContentScope(userId: string, jobId: string): Promise<JobContentScope> {
  const rows = await prisma.schedule.findMany({
    where: { jobId, userId },
    select: { id: true, description: true, restrictContent: true, visibleAttachmentIds: true, visibleNoteIds: true },
  })
  const limiting = rows.filter(
    (r) => r.restrictContent && !String(r.description || '').startsWith(AUTO_SCHEDULE_MARKER)
  )
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
