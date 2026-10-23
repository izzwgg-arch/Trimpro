import { hasPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { JOB_TYPE_VALUES, parseOptionalJobType, type JobTypeValue } from '@/lib/jobs/types'

export const ACCESS_ALL_JOB_TYPES_PERMISSION = 'jobs.access_all_types'

export function parseAssignedJobTypes(value: unknown): JobTypeValue[] {
  if (!Array.isArray(value)) return []
  const unique = new Set<JobTypeValue>()
  for (const item of value) {
    if (typeof item === 'string' && (JOB_TYPE_VALUES as readonly string[]).includes(item)) {
      unique.add(item as JobTypeValue)
    }
  }
  return Array.from(unique)
}

export async function canAccessAllJobTypes(userId: string, tenantId: string): Promise<boolean> {
  return hasPermission(userId, tenantId, ACCESS_ALL_JOB_TYPES_PERMISSION)
}

export async function getUserAssignedJobTypes(userId: string, tenantId: string): Promise<JobTypeValue[]> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { assignedJobTypes: true },
  })
  return parseAssignedJobTypes(user?.assignedJobTypes)
}

/**
 * Prisma where fragment for Job/Lead.jobType scoping.
 * - Has jobs.access_all_types → no filter
 * - Has assigned types → only those types
 * - No assigned types yet → no filter (until types are set on the user)
 */
export async function jobTypeScopeWhere(
  userId: string,
  tenantId: string
): Promise<Record<string, never> | { jobType: { in: JobTypeValue[] } }> {
  if (await canAccessAllJobTypes(userId, tenantId)) {
    return {}
  }
  const types = await getUserAssignedJobTypes(userId, tenantId)
  if (types.length === 0) {
    return {}
  }
  return { jobType: { in: types } }
}

export async function canAccessJobType(
  userId: string,
  tenantId: string,
  jobType: string | null | undefined
): Promise<boolean> {
  // Records without a type are open to everyone.
  const type = parseOptionalJobType(jobType)
  if (!type) return true
  if (await canAccessAllJobTypes(userId, tenantId)) return true
  const types = await getUserAssignedJobTypes(userId, tenantId)
  if (types.length === 0) return true
  return types.includes(type)
}

/**
 * Job-type scoping for jobs (whose type can be empty): the person's types, plus jobs
 * without a type. AND-wrapped so it can be spread next to a where with its own OR.
 */
export async function jobTypeScopeWhereForJobs(userId: string, tenantId: string): Promise<Record<string, unknown>> {
  if (await canAccessAllJobTypes(userId, tenantId)) return {}
  const types = await getUserAssignedJobTypes(userId, tenantId)
  if (types.length === 0) return {}
  return { AND: [{ OR: [{ jobType: { in: types } }, { jobType: null }] }] }
}

export async function assertCanAccessJobType(
  userId: string,
  tenantId: string,
  jobType: string | null | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await canAccessJobType(userId, tenantId, jobType)) {
    return { ok: true }
  }
  return { ok: false, error: 'You do not have access to this job type' }
}

/**
 * Apply an optional list filter for a single job type onto a Prisma where object.
 * Preserves existing jobType scope (`{ in: [...] }`) by intersecting when needed.
 */
export function applyJobTypeListFilter(
  where: Record<string, any>,
  jobTypeParam: string | null | undefined
): void {
  if (!jobTypeParam || jobTypeParam === 'all') return
  if (!(JOB_TYPE_VALUES as readonly string[]).includes(jobTypeParam)) return

  const existing = where.jobType
  if (existing && typeof existing === 'object' && Array.isArray(existing.in)) {
    where.jobType = existing.in.includes(jobTypeParam) ? jobTypeParam : { in: [] as JobTypeValue[] }
    return
  }
  where.jobType = jobTypeParam
}

export async function resolveJobTypeForWrite(
  userId: string,
  tenantId: string,
  requested: unknown,
  fallback: JobTypeValue | null = null
): Promise<{ ok: true; jobType: JobTypeValue | null } | { ok: false; error: string }> {
  // Nothing (or nothing valid) chosen: keep the fallback — null means "no type yet".
  const jobType = parseOptionalJobType(requested) ?? fallback
  const allowed = await assertCanAccessJobType(userId, tenantId, jobType)
  if (!allowed.ok) return allowed
  return { ok: true, jobType }
}
