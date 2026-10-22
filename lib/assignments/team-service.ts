import { prisma } from '@/lib/prisma'
import { primaryAssigneeId, type TeamInput } from '@/lib/assignments/roles'

export type SetTeamResult =
  | { ok: true; added: string[]; removed: string[]; primaryAssigneeId: string | null }
  | { ok: false; status: number; error: string }

/** Returns an error message when someone on the team is not an active user in this account. */
export async function validateUsers(tenantId: string, team: TeamInput): Promise<string | null> {
  const ids = team.map((t) => t.userId)
  if (ids.length === 0) return null
  const found = await prisma.user.findMany({
    where: { id: { in: ids }, tenantId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (found.length !== ids.length) return 'One or more selected people are not active users in this account'
  return null
}

/** Replace a task's team. Keeps Task.assigneeId pointing at the primary person. */
export async function setTaskTeam(tenantId: string, taskId: string, team: TeamInput): Promise<SetTeamResult> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, tenantId },
    select: { id: true, assigneeId: true, assignments: { select: { userId: true } } },
  })
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  const invalid = await validateUsers(tenantId, team)
  if (invalid) return { ok: false, status: 400, error: invalid }

  const before = new Set([...task.assignments.map((a) => a.userId), ...(task.assigneeId ? [task.assigneeId] : [])])
  const after = new Set(team.map((t) => t.userId))
  const primary = primaryAssigneeId(team)

  await prisma.$transaction(async (tx) => {
    await tx.taskAssignment.deleteMany({ where: { taskId, userId: { notIn: [...after] } } })
    for (const t of team) {
      await tx.taskAssignment.upsert({
        where: { taskId_userId: { taskId, userId: t.userId } },
        create: { taskId, userId: t.userId, role: t.role },
        update: { role: t.role },
      })
    }
    await tx.task.update({ where: { id: taskId }, data: { assigneeId: primary } })
  })

  return {
    ok: true,
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
    primaryAssigneeId: primary,
  }
}

/** Replace an issue's team. Keeps Issue.assigneeId pointing at the primary person. */
export async function setIssueTeam(tenantId: string, issueId: string, team: TeamInput): Promise<SetTeamResult> {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, tenantId },
    select: { id: true, assigneeId: true, assignments: { select: { userId: true } } },
  })
  if (!issue) return { ok: false, status: 404, error: 'Issue not found' }
  const invalid = await validateUsers(tenantId, team)
  if (invalid) return { ok: false, status: 400, error: invalid }

  const before = new Set([...issue.assignments.map((a) => a.userId), ...(issue.assigneeId ? [issue.assigneeId] : [])])
  const after = new Set(team.map((t) => t.userId))
  const primary = primaryAssigneeId(team)

  await prisma.$transaction(async (tx) => {
    await tx.issueAssignment.deleteMany({ where: { issueId, userId: { notIn: [...after] } } })
    for (const t of team) {
      await tx.issueAssignment.upsert({
        where: { issueId_userId: { issueId, userId: t.userId } },
        create: { issueId, userId: t.userId, role: t.role },
        update: { role: t.role },
      })
    }
    await tx.issue.update({ where: { id: issueId }, data: { assigneeId: primary } })
  })

  return {
    ok: true,
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
    primaryAssigneeId: primary,
  }
}

/** Replace a job's team (JobAssignment rows). */
export async function setJobTeam(tenantId: string, jobId: string, team: TeamInput): Promise<SetTeamResult> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId },
    select: { id: true, assignments: { select: { userId: true } } },
  })
  if (!job) return { ok: false, status: 404, error: 'Job not found' }
  const invalid = await validateUsers(tenantId, team)
  if (invalid) return { ok: false, status: 400, error: invalid }

  const before = new Set(job.assignments.map((a) => a.userId))
  const after = new Set(team.map((t) => t.userId))

  await prisma.$transaction(async (tx) => {
    await tx.jobAssignment.deleteMany({ where: { jobId, userId: { notIn: [...after] } } })
    for (const t of team) {
      await tx.jobAssignment.upsert({
        where: { jobId_userId: { jobId, userId: t.userId } },
        create: { jobId, userId: t.userId, role: t.role },
        update: { role: t.role },
      })
    }
  })

  return {
    ok: true,
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
    primaryAssigneeId: null,
  }
}
