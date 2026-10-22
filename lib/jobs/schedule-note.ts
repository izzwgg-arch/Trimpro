import { prisma } from '@/lib/prisma'

const AUTO_SCHEDULE_MARKER = '[AUTO_JOB_SCHEDULE]'

/**
 * A schedule's description becomes a note on its job, so the scheduled person can read
 * it there (and it is always among what they may see). One note per schedule: saving the
 * schedule again updates it, clearing the description removes it, and moving the schedule
 * to another job moves the note.
 *
 * Call after the schedule row is saved. Returns the note id, or null when there is none.
 */
export async function syncScheduleNote(params: {
  scheduleId: string
  jobId: string | null
  description: string | null | undefined
  createdById?: string | null
}): Promise<string | null> {
  const { scheduleId, jobId, createdById } = params
  const text = String(params.description || '').trim()
  const keep = Boolean(jobId) && text.length > 0 && !text.startsWith(AUTO_SCHEDULE_MARKER)

  const existing = await prisma.note.findFirst({
    where: { scheduleId },
    select: { id: true, jobId: true, content: true },
  })

  let noteId: string | null = null
  if (keep) {
    if (existing) {
      if (existing.content !== text || existing.jobId !== jobId) {
        await prisma.note.update({ where: { id: existing.id }, data: { content: text, jobId } })
      }
      noteId = existing.id
    } else {
      const created = await prisma.note.create({
        data: { jobId, content: text, scheduleId, createdById: createdById || null },
        select: { id: true },
      })
      noteId = created.id
    }
  } else if (existing) {
    await prisma.note.delete({ where: { id: existing.id } })
  }

  // Keep the schedule's shared-notes list in step: its own note is always included.
  const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId }, select: { visibleNoteIds: true } })
  if (schedule) {
    const others = schedule.visibleNoteIds.filter((id) => id !== existing?.id && id !== noteId)
    const next = noteId ? [...others, noteId] : others
    if (next.length !== schedule.visibleNoteIds.length || next.some((id, i) => id !== schedule.visibleNoteIds[i])) {
      await prisma.schedule.update({ where: { id: scheduleId }, data: { visibleNoteIds: next } })
    }
  }
  return noteId
}
