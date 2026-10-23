import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { hasPermission } from '@/lib/authorization'
import { getUserAssignedJobTypes } from '@/lib/jobs/job-type-scope'
import { requestDisplayName, requestSubtitle } from '@/lib/requests/display'

// Sidebar "New" badges: records still in their initial status that are meant for
// this person — they are assigned to it, or nobody is assigned and it is in a job
// type they belong to. The badge clears as soon as the status changes.
const RECENT_JOB_DAYS = 7
const LIMIT = 50

type Item = { id: string; title: string; message: string | null; linkUrl: string; createdAt: Date }

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const me = user.id
  const tenantId = user.tenantId

  try {
    const myTypes = await getUserAssignedJobTypes(me, tenantId)
    const inMyTypes = (path: 'jobType' | 'job' | 'lead') =>
      myTypes.length === 0
        ? { id: { in: [] as string[] } } // not in any job type: only assigned records
        : path === 'jobType'
          ? { jobType: { in: myTypes } }
          : { [path]: { jobType: { in: myTypes } } }

    const [canLeads, canJobs, canTasks, canIssues] = await Promise.all([
      hasPermission(me, tenantId, 'leads.view'),
      hasPermission(me, tenantId, 'jobs.view'),
      hasPermission(me, tenantId, 'tasks.view'),
      hasPermission(me, tenantId, 'issues.view'),
    ])

    const jobCutoff = new Date(Date.now() - RECENT_JOB_DAYS * 86400000)

    const [leads, jobs, tasks, issues] = await Promise.all([
      canLeads
        ? prisma.lead.findMany({
            where: {
              tenantId,
              status: 'NEW',
              OR: [{ assignedToId: me }, { assignedToId: null, ...inMyTypes('jobType') }],
            },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
            select: { id: true, firstName: true, lastName: true, company: true, notes: true, jobSiteAddress: true, createdAt: true },
          })
        : [],
      canJobs
        ? prisma.job.findMany({
            where: {
              tenantId,
              status: 'QUOTE',
              createdAt: { gte: jobCutoff },
              OR: [
                { assignments: { some: { userId: me } } },
                { assignments: { none: {} }, ...inMyTypes('jobType') },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
            select: { id: true, jobNumber: true, title: true, createdAt: true, client: { select: { name: true } } },
          })
        : [],
      canTasks
        ? prisma.task.findMany({
            where: {
              tenantId,
              status: 'TODO',
              OR: [
                { assigneeId: me },
                { assignments: { some: { userId: me } } },
                {
                  assigneeId: null,
                  assignments: { none: {} },
                  OR: [inMyTypes('job'), inMyTypes('lead')],
                },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
            select: { id: true, title: true, description: true, createdAt: true },
          })
        : [],
      canIssues
        ? prisma.issue.findMany({
            where: {
              tenantId,
              status: 'OPEN',
              OR: [
                { assigneeId: me },
                { assignments: { some: { userId: me } } },
                { assigneeId: null, assignments: { none: {} }, ...inMyTypes('job') },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
            select: { id: true, title: true, description: true, createdAt: true },
          })
        : [],
    ])

    const out: Record<string, Item[]> = {
      Requests: leads.map((r) => ({
        id: r.id,
        title: requestDisplayName(r),
        message: requestSubtitle(r) || r.notes || null,
        linkUrl: `/dashboard/requests/${r.id}`,
        createdAt: r.createdAt,
      })),
      Jobs: jobs.map((r) => ({
        id: r.id,
        title: [r.jobNumber, r.title].filter(Boolean).join(' · ') || 'New job',
        message: r.client?.name || null,
        linkUrl: `/dashboard/jobs/${r.id}`,
        createdAt: r.createdAt,
      })),
      Tasks: tasks.map((r) => ({
        id: r.id,
        title: r.title || 'New task',
        message: r.description || null,
        linkUrl: `/dashboard/tasks/${r.id}`,
        createdAt: r.createdAt,
      })),
      Issues: issues.map((r) => ({
        id: r.id,
        title: r.title || 'New issue',
        message: r.description || null,
        linkUrl: `/dashboard/issues/${r.id}`,
        createdAt: r.createdAt,
      })),
    }
    return NextResponse.json(out)
  } catch (error) {
    console.error('Nav badges error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
