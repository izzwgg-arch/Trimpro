import { prisma } from '@/lib/prisma'
import { createNotificationsForUsers } from '@/lib/notifications'
import { getProductionConfigForTenant } from '@/lib/production/settings'
import type { JobStatusValue } from '@/lib/jobs/statuses'

/**
 * Optional Production automation side-effects when a Job's status changes.
 * The core automation (board column, stage, next action) is inherent because
 * Production is derived from Job.status — nothing to do there. This only runs
 * the admin-configured OPTIONAL hooks (create a Task / notify assignees),
 * reusing the existing Task and Notification systems. Best-effort: never
 * blocks or fails the status update.
 */
export async function applyProductionAutomation(params: {
  tenantId: string
  actorUserId: string
  newStatus: JobStatusValue | string
  job: { id: string; jobNumber: string; title: string; clientId: string }
}): Promise<void> {
  const { tenantId, actorUserId, newStatus, job } = params
  try {
    const config = await getProductionConfigForTenant(tenantId)
    const auto = (config.automation as any)[newStatus]
    if (!auto) return
    const stage = config.stages.find((s) => s.status === newStatus)
    const stageName = stage?.displayName || String(newStatus)

    if (auto.createTask) {
      const assignment = await prisma.jobAssignment.findFirst({ where: { jobId: job.id }, select: { userId: true } })
      const title =
        (auto.createTaskTitle && String(auto.createTaskTitle).trim()) ||
        `${stageName}: ${job.jobNumber}`
      await prisma.task.create({
        data: {
          tenantId,
          title,
          description: `Auto-created when ${job.jobNumber} entered "${stageName}".`,
          jobId: job.id,
          clientId: job.clientId || null,
          assigneeId: assignment?.userId || null,
          createdById: actorUserId,
        },
      })
    }

    if (auto.notifyAssignedUser) {
      const assignments = await prisma.jobAssignment.findMany({ where: { jobId: job.id }, select: { userId: true } })
      const userIds = assignments.map((a) => a.userId)
      if (userIds.length > 0) {
        await createNotificationsForUsers(tenantId, userIds, {
          type: 'JOB_UPDATED',
          title: 'Production stage updated',
          message: `${job.jobNumber} moved to ${stageName}.`,
          linkUrl: `/dashboard/jobs/${job.id}`,
          linkType: 'job',
          linkId: job.id,
          actorUserId,
          action: 'production_stage_changed',
        })
      }
    }
  } catch (err) {
    console.error('applyProductionAutomation failed (non-fatal):', err)
  }
}
