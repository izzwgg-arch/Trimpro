import { prisma } from '@/lib/prisma'

/**
 * Keep the job's description as a real note on the job (marked isJobDescription),
 * so it can be shared with a scheduled person like any other note.
 *
 * - Creates the note when the job has a description and no description note yet.
 * - With `syncContent`, updates the note when the description changes.
 * Returns the note id, or null when the job has no description.
 */
export async function ensureJobDescriptionNote(params: {
  jobId: string
  description?: string | null
  createdById?: string | null
  syncContent?: boolean
}): Promise<string | null> {
  const { jobId, createdById, syncContent } = params

  let description = params.description
  if (description === undefined) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { description: true } })
    description = job?.description ?? null
  }
  const text = String(description || '').trim()

  const existing = await prisma.note.findFirst({
    where: { jobId, isJobDescription: true },
    select: { id: true, content: true },
    orderBy: { createdAt: 'asc' },
  })

  if (existing) {
    if (syncContent && text && existing.content !== text) {
      await prisma.note.update({ where: { id: existing.id }, data: { content: text } })
    }
    return existing.id
  }
  if (!text) return null

  const created = await prisma.note.create({
    data: { jobId, content: text, isJobDescription: true, createdById: createdById || null },
    select: { id: true },
  })
  return created.id
}
