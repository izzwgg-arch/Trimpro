import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { hasMobilePermission, requireAnyPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { guardSchedule } from '@/lib/assignments/scope'
import { formatAddressParts } from '@/lib/address/parse'
import { normalizePublicFileUrl } from '@/lib/public-url'
import { normalizeAssignmentRole } from '@/lib/assignments/roles'
import { summarizeWork } from '@/lib/schedules/work'

const AUTO_SCHEDULE_MARKER = '[AUTO_JOB_SCHEDULE]'
const personName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim()

/**
 * GET — everything the schedule screen needs for one visit: customer (name and phone
 * only), job site, job number, site manager(s), the instructions and notes, the
 * attachments chosen for this visit, and the person's work status and time.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireAnyPermission(request, ['schedule.view', 'schedule.view_all'])
  if (permError) return permError
  const user = getAuthUser(request)
  const scopeError = await guardSchedule(user, params.id)
  if (scopeError) return scopeError

  try {
    const schedule = await prisma.schedule.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true } },
        siteManager: { select: { id: true, firstName: true, lastName: true, phone: true } },
        checklist: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, isCompleted: true, sortOrder: true } },
        timeEntries: { where: { deletedAt: null }, select: { startedAt: true, endedAt: true, status: true, createdAt: true } },
        job: {
          select: {
            id: true,
            jobNumber: true,
            title: true,
            status: true,
            client: {
              select: {
                name: true,
                companyName: true,
                phone: true,
                contacts: { where: { isPrimary: true }, take: 1, select: { firstName: true, lastName: true, phone: true } },
              },
            },
            addresses: { where: { type: 'job_site' }, take: 1, select: { street: true, city: true, state: true, zipCode: true } },
            assignments: {
              select: { role: true, user: { select: { id: true, firstName: true, lastName: true, phone: true, role: true } } },
            },
          },
        },
      },
    })
    if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

    const isOwn = schedule.userId === user.id
    // Managers can open anyone's schedule; everyone else only their own.
    const canManage =
      user.role === 'ADMIN' ||
      (await hasMobilePermission(user.id, user.tenantId, 'canCreateSchedulesForOthers')) ||
      (await hasMobilePermission(user.id, user.tenantId, 'mobile.jobs.assign'))
    if (!isOwn && !canManage) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

    const job = schedule.job
    const description = String(schedule.description || '')
    const instructions = description.startsWith(AUTO_SCHEDULE_MARKER) ? '' : description

    // Notes and files for this visit: the ones picked on the schedule, or everything on
    // the job when the schedule shares everything.
    let notes: Array<{ id: string; content: string; createdAt: string }> = []
    let attachments: Array<{ id: string; fileName: string; mimeType: string; fileSize: number; url: string }> = []
    if (job) {
      const [noteRows, fileRows] = await Promise.all([
        prisma.note.findMany({
          where: {
            jobId: job.id,
            ...(schedule.restrictContent ? { id: { in: schedule.visibleNoteIds } } : {}),
            // This schedule's own note is the instructions, shown on its own.
            OR: [{ scheduleId: null }, { scheduleId: { not: schedule.id } }],
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, content: true, createdAt: true },
        }),
        prisma.attachment.findMany({
          where: { jobId: job.id, ...(schedule.restrictContent ? { id: { in: schedule.visibleAttachmentIds } } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { id: true, fileName: true, mimeType: true, fileSize: true, url: true },
        }),
      ])
      notes = noteRows.map((n) => ({ id: n.id, content: n.content, createdAt: n.createdAt.toISOString() }))
      attachments = fileRows.map((a) => ({ ...a, url: normalizePublicFileUrl(a.url, request) }))
    }

    const client = job?.client
    const contact = client?.contacts?.[0]
    // Site managers from the job crew, plus this visit's own chosen site manager (if any).
    const siteManagers = (job?.assignments || [])
      .filter((a) => normalizeAssignmentRole(a.role, a.user.role) === 'SITE_MANAGER')
      .map((a) => ({ id: a.user.id, name: personName(a.user), phone: a.user.phone || null }))
    const visitSiteManager = schedule.siteManager
      ? { id: schedule.siteManager.id, name: personName(schedule.siteManager), phone: schedule.siteManager.phone || null }
      : null
    if (visitSiteManager && !siteManagers.some((s) => s.id === visitSiteManager.id)) {
      siteManagers.unshift(visitSiteManager)
    }

    return NextResponse.json({
      schedule: {
        id: schedule.id,
        title: schedule.title,
        type: schedule.type,
        startTime: schedule.startTime.toISOString(),
        endTime: schedule.endTime.toISOString(),
        allDay: schedule.allDay,
        instructions,
        worker: { id: schedule.user.id, name: personName(schedule.user), phone: schedule.user.phone || null },
      },
      job: job
        ? {
            id: job.id,
            jobNumber: job.jobNumber,
            title: job.title,
            status: job.status,
            siteAddress: formatAddressParts(job.addresses[0] || null) || '',
          }
        : null,
      customer: client
        ? {
            name: client.companyName || client.name,
            phone: client.phone || contact?.phone || null,
            contactName: contact ? personName(contact) : null,
          }
        : null,
      siteManagers,
      visitSiteManager,
      checklist: schedule.checklist.map((c) => ({ id: c.id, title: c.title, isCompleted: c.isCompleted })),
      notes,
      attachments,
      work: summarizeWork(schedule, schedule.timeEntries),
      canWork: isOwn && Boolean(job),
      canManage,
    })
  } catch (err) {
    console.error('Schedule details error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
