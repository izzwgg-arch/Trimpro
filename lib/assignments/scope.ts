import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/authorization'
import { assignedToUserWhere } from '@/lib/assignments/where'

/**
 * "See only assigned ..." restrictions. A role that has `<module>.assigned_only`
 * can only see records it is assigned to. Opt-in, and never applied to admins.
 * Enforce on the server so web and mobile behave the same.
 */
export type ScopedModule = 'jobs' | 'tasks' | 'issues' | 'leads' | 'schedule'

type ScopeUser = { id: string; tenantId: string; role: string }

const PERMISSION_KEY: Record<ScopedModule, string> = {
  jobs: 'jobs.assigned_only',
  tasks: 'tasks.assigned_only',
  issues: 'issues.assigned_only',
  leads: 'leads.assigned_only',
  schedule: 'schedule.assigned_only',
}

export async function isAssignedOnly(user: ScopeUser, module: ScopedModule): Promise<boolean> {
  if (user.role === 'ADMIN') return false
  return hasPermission(user.id, user.tenantId, PERMISSION_KEY[module])
}

// Prisma `where` fragments — always AND these in; never assign them over an existing filter.
// A job is yours when you are on its crew OR you have been scheduled on it.
// Wrapped in AND so it can be spread next to a where that has its own OR.
export const jobScopeWhere = (userId: string) => ({
  AND: [{ OR: [{ assignments: { some: { userId } } }, { schedules: { some: { userId } } }] }],
})
export const taskScopeWhere = (userId: string) => assignedToUserWhere(userId)
export const issueScopeWhere = (userId: string) => assignedToUserWhere(userId)
export const leadScopeWhere = (userId: string) => ({ assignedToId: userId })
export const measuringRequestScopeWhere = (userId: string) => ({ assignedUserId: userId })
export const scheduleScopeWhere = (userId: string) => ({ userId })

/** Add a scope fragment to a where object without disturbing what is already there. */
export function andScope(where: any, fragment: unknown) {
  where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), fragment]
  return where
}

const notFound = (what: string) => NextResponse.json({ error: `${what} not found` }, { status: 404 })

/** Null when the person may see this job; otherwise a 404 response to return. */
export async function guardJob(user: ScopeUser, jobId: string): Promise<NextResponse | null> {
  if (!(await isAssignedOnly(user, 'jobs'))) return null
  const hit = await prisma.job.findFirst({
    where: { id: jobId, tenantId: user.tenantId, ...jobScopeWhere(user.id) },
    select: { id: true },
  })
  return hit ? null : notFound('Job')
}

export async function guardTask(user: ScopeUser, taskId: string): Promise<NextResponse | null> {
  if (!(await isAssignedOnly(user, 'tasks'))) return null
  const hit = await prisma.task.findFirst({
    where: { id: taskId, tenantId: user.tenantId, ...taskScopeWhere(user.id) },
    select: { id: true },
  })
  return hit ? null : notFound('Task')
}

export async function guardIssue(user: ScopeUser, issueId: string): Promise<NextResponse | null> {
  if (!(await isAssignedOnly(user, 'issues'))) return null
  const hit = await prisma.issue.findFirst({
    where: { id: issueId, tenantId: user.tenantId, ...issueScopeWhere(user.id) },
    select: { id: true },
  })
  return hit ? null : notFound('Issue')
}

export async function guardLead(user: ScopeUser, leadId: string): Promise<NextResponse | null> {
  if (!(await isAssignedOnly(user, 'leads'))) return null
  const hit = await prisma.lead.findFirst({
    where: { id: leadId, tenantId: user.tenantId, assignedToId: user.id },
    select: { id: true },
  })
  return hit ? null : notFound('Request')
}

/** Someone limited to "my schedule" may only open their own schedule entries. */
export async function guardSchedule(user: ScopeUser, scheduleId: string): Promise<NextResponse | null> {
  if (!(await isAssignedOnly(user, 'schedule'))) return null
  const hit = await prisma.schedule.findFirst({
    where: { id: scheduleId, tenantId: user.tenantId, userId: user.id },
    select: { id: true },
  })
  return hit ? null : notFound('Schedule')
}

/** Check the entity an attachment (or other child record) hangs off. */
export async function guardEntity(
  user: ScopeUser,
  entity: { jobId?: string | null; taskId?: string | null; issueId?: string | null; leadId?: string | null }
): Promise<NextResponse | null> {
  if (entity.jobId) {
    const r = await guardJob(user, entity.jobId)
    if (r) return r
  }
  if (entity.taskId) {
    const r = await guardTask(user, entity.taskId)
    if (r) return r
  }
  if (entity.issueId) {
    const r = await guardIssue(user, entity.issueId)
    if (r) return r
  }
  if (entity.leadId) {
    const r = await guardLead(user, entity.leadId)
    if (r) return r
  }
  return null
}
