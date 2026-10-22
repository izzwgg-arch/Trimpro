import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { canSetContentVisibility } from '@/lib/jobs/content-visibility'
import { ensureJobDescriptionNote } from '@/lib/jobs/description-note'
import { guardJob } from '@/lib/assignments/scope'

// GET — what can be shared with a scheduled person on this job: every attachment
// and note. The job description note is created on demand and listed first. Notes made
// from a schedule's description (scheduleId) are always shared with that schedule's person.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const scopeError = await guardJob(user, params.id)
  if (scopeError) return scopeError
  if (!(await canSetContentVisibility(user))) {
    return NextResponse.json(
      { error: 'You do not have permission to choose what scheduled people can see' },
      { status: 403 }
    )
  }

  try {
    const job = await prisma.job.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true, description: true },
    })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    await ensureJobDescriptionNote({ jobId: job.id, description: job.description, createdById: user.id })

    const [attachments, notes] = await Promise.all([
      prisma.attachment.findMany({
        where: { jobId: job.id },
        select: { id: true, fileName: true, fileSize: true, mimeType: true, url: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.note.findMany({
        where: { jobId: job.id },
        select: { id: true, content: true, isJobDescription: true, scheduleId: true, createdAt: true },
        orderBy: [{ isJobDescription: 'desc' }, { createdAt: 'desc' }],
      }),
    ])

    return NextResponse.json({ attachments, notes })
  } catch (error) {
    console.error('Get job share options error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
