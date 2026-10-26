import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { hasMobilePermission, hasPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { guardSchedule } from '@/lib/assignments/scope'
import { syncJobBillableMinutes } from '@/lib/time-tracking'
import { createNotificationsForUsers } from '@/lib/notifications'
import { minutesBetween, planWorkAction, summarizeWork, WORK_ACTIONS, type WorkAction, type WorkStatus } from '@/lib/schedules/work'

const timeEntrySelect = { startedAt: true, endedAt: true, status: true, createdAt: true } as const

/**
 * POST { action: 'start' | 'pause' | 'resume' | 'finish', completionNotes? }
 * Only the person the schedule is for can do this, on their own visit. Repeating an
 * action (e.g. a retried request) changes nothing and returns the current state.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)
  const scopeError = await guardSchedule(user, params.id)
  if (scopeError) return scopeError

  const body = await request.json().catch(() => ({}))
  const action = String(body?.action || '') as WorkAction
  if (!WORK_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'action must be start, pause, resume or finish' }, { status: 400 })
  }

  const schedule = await prisma.schedule.findFirst({
    where: { id: params.id, tenantId: user.tenantId },
    select: { id: true, userId: true, jobId: true, title: true, job: { select: { id: true, jobNumber: true } } },
  })
  if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  if (schedule.userId !== user.id) {
    return NextResponse.json({ error: 'Only the person on this schedule can start or finish it' }, { status: 403 })
  }
  if (!schedule.jobId || !schedule.job) {
    return NextResponse.json({ error: 'This schedule is not linked to a job' }, { status: 400 })
  }
  const canTrack =
    user.role === 'ADMIN' ||
    (await hasMobilePermission(user.id, user.tenantId, 'mobile.jobs.track_time')) ||
    (await hasPermission(user.id, user.tenantId, 'web.jobs.edit_time_entries'))
  if (!canTrack) {
    return NextResponse.json({ error: 'You do not have permission to track time' }, { status: 403 })
  }

  const jobId = schedule.jobId
  const completionNotes =
    typeof body?.completionNotes === 'string' ? body.completionNotes.trim().slice(0, 4000) || null : null

  try {
    const result = await prisma.$transaction(async (tx) => {
      // One action at a time per schedule (double taps, retries).
      await tx.$queryRaw`SELECT id FROM schedules WHERE id = ${schedule.id} FOR UPDATE`
      const current = await tx.schedule.findUniqueOrThrow({
        where: { id: schedule.id },
        select: { workStatus: true, workStartedAt: true, workFinishedAt: true, completionNotes: true },
      })
      const plan = planWorkAction(current.workStatus as WorkStatus, action)
      if (plan.kind === 'error') return { error: plan.message }
      const now = new Date()

      const closeOpenSegment = async () => {
        const open = await tx.timeEntry.findFirst({
          where: { tenantId: user.tenantId, scheduleId: schedule.id, status: 'ACTIVE', deletedAt: null },
        })
        if (!open) return
        const start = open.startedAt ?? open.createdAt
        await tx.timeEntry.update({
          where: { id: open.id },
          data: { endedAt: now, durationMinutes: minutesBetween(start, now), status: 'STOPPED', updatedById: user.id },
        })
      }

      let changed = false
      if (plan.kind === 'open') {
        // Reuse a job timer this person already has running instead of making a second one.
        const running = await tx.timeEntry.findFirst({
          where: { tenantId: user.tenantId, jobId, workerId: user.id, status: 'ACTIVE', deletedAt: null },
        })
        if (running) {
          if (!running.scheduleId) {
            await tx.timeEntry.update({ where: { id: running.id }, data: { scheduleId: schedule.id, updatedById: user.id } })
          }
        } else {
          await tx.timeEntry.create({
            data: {
              tenantId: user.tenantId,
              jobId,
              workerId: user.id,
              scheduleId: schedule.id,
              startedAt: now,
              source: 'TIMER',
              status: 'ACTIVE',
              note: `Schedule: ${schedule.title}`,
              createdById: user.id,
              updatedById: user.id,
            },
          })
        }
        await tx.schedule.update({
          where: { id: schedule.id },
          data: { workStatus: 'IN_PROGRESS', workStartedAt: current.workStartedAt ?? now },
        })
        changed = true
      } else if (plan.kind === 'close') {
        await closeOpenSegment()
        await tx.schedule.update({ where: { id: schedule.id }, data: { workStatus: 'PAUSED' } })
        changed = true
      } else if (plan.kind === 'finish') {
        await closeOpenSegment()
        await tx.schedule.update({
          where: { id: schedule.id },
          data: { workStatus: 'COMPLETED', workFinishedAt: now, completionNotes },
        })
        changed = true
      }

      if (changed) {
        await tx.activity.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            type: 'OTHER',
            description: `${{ start: 'Started', pause: 'Paused', resume: 'Resumed', finish: 'Finished' }[action]} work on "${schedule.title}" (${schedule.job!.jobNumber})`,
            jobId,
            metadata: { scheduleId: schedule.id, workAction: action },
          },
        })
      }
      return { changed }
    })

    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 })

    if (result.changed) {
      await syncJobBillableMinutes(user.tenantId, jobId)
      if (action === 'finish') {
        const managers = await prisma.jobAssignment.findMany({
          where: { jobId, role: 'SITE_MANAGER', userId: { not: user.id } },
          select: { userId: true },
        })
        if (managers.length) {
          await createNotificationsForUsers(
            user.tenantId,
            managers.map((m) => m.userId),
            {
              type: 'JOB_UPDATED',
              title: 'Visit finished',
              message: `${schedule.title} (${schedule.job.jobNumber}) was finished${completionNotes ? `: ${completionNotes.slice(0, 120)}` : ''}`,
              linkType: 'schedule',
              linkId: schedule.id,
              linkUrl: `/dashboard/schedule/${schedule.id}`,
              actorUserId: user.id,
              action: 'schedule_work_finished',
            } as any
          )
        }
      }
    }

    const [fresh, entries] = await Promise.all([
      prisma.schedule.findUniqueOrThrow({
        where: { id: schedule.id },
        select: { workStatus: true, workStartedAt: true, workFinishedAt: true, completionNotes: true },
      }),
      prisma.timeEntry.findMany({ where: { scheduleId: schedule.id, deletedAt: null }, select: timeEntrySelect }),
    ])
    return NextResponse.json({ work: summarizeWork(fresh, entries), changed: result.changed })
  } catch (err) {
    console.error('Schedule work action error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
