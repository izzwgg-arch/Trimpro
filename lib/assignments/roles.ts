/**
 * Team roles for jobs, tasks and issues. Any active user can hold any role on
 * any item; several people can share a role.
 */
export const ASSIGNMENT_ROLES = [
  { value: 'SITE_MANAGER', label: 'Site Managers', singular: 'Site Manager' },
  { value: 'OFFICE_WORKER', label: 'Office Workers', singular: 'Office Worker' },
  { value: 'FIELD_WORKER', label: 'Field Workers', singular: 'Field Worker' },
] as const

export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number]['value']

const ROLE_VALUES = new Set<string>(ASSIGNMENT_ROLES.map((r) => r.value))

export function isAssignmentRole(value: unknown): value is AssignmentRole {
  return typeof value === 'string' && ROLE_VALUES.has(value)
}

export function assignmentRoleLabel(role: string | null | undefined): string {
  return ASSIGNMENT_ROLES.find((r) => r.value === role)?.singular || 'Field Worker'
}

/**
 * Role to show for an assignment that has no (or an old free-text) role, such
 * as every assignment made before roles existed: derived from the person's
 * account role.
 */
export function defaultRoleForUser(accountRole: string | null | undefined): AssignmentRole {
  switch (String(accountRole || '').toUpperCase()) {
    case 'ADMIN':
    case 'MANAGER':
      return 'SITE_MANAGER'
    case 'OFFICE':
    case 'ACCOUNTING':
    case 'SALES':
      return 'OFFICE_WORKER'
    default:
      return 'FIELD_WORKER'
  }
}

export function normalizeAssignmentRole(
  role: string | null | undefined,
  accountRole?: string | null
): AssignmentRole {
  return isAssignmentRole(role) ? role : defaultRoleForUser(accountRole)
}

export type TeamMember = {
  userId: string
  role: AssignmentRole
  user: { id: string; firstName: string; lastName: string; role?: string | null }
}

type RawAssignment = {
  userId: string
  role?: string | null
  user?: { id: string; firstName: string; lastName: string; role?: string | null } | null
}

/**
 * Build the team list for an item: its assignment rows, plus the legacy single
 * assignee when that person has no row yet (items created before teams existed).
 */
export function buildTeam(
  assignments: RawAssignment[] | null | undefined,
  legacyAssignee?: { id: string; firstName: string; lastName: string; role?: string | null } | null
): TeamMember[] {
  const team: TeamMember[] = []
  const seen = new Set<string>()
  for (const a of assignments || []) {
    if (!a?.userId || !a.user || seen.has(a.userId)) continue
    seen.add(a.userId)
    team.push({ userId: a.userId, role: normalizeAssignmentRole(a.role, a.user.role), user: a.user })
  }
  if (legacyAssignee && !seen.has(legacyAssignee.id)) {
    team.push({
      userId: legacyAssignee.id,
      role: defaultRoleForUser(legacyAssignee.role),
      user: legacyAssignee,
    })
  }
  return team
}

export type TeamInput = Array<{ userId: string; role: AssignmentRole }>

/** Validate and de-duplicate a team payload from the client (a person appears once). */
export function parseTeamInput(input: unknown): { ok: true; team: TeamInput } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'assignments must be an array' }
  const byUser = new Map<string, AssignmentRole>()
  for (const raw of input) {
    const userId = String((raw as any)?.userId || '').trim()
    const role = (raw as any)?.role
    if (!userId) return { ok: false, error: 'Each assignment needs a user' }
    if (!isAssignmentRole(role)) return { ok: false, error: 'Each assignment needs a valid role' }
    byUser.set(userId, role)
  }
  return { ok: true, team: Array.from(byUser, ([userId, role]) => ({ userId, role })) }
}

/** The 'primary' assignee kept in Task/Issue.assigneeId: site manager first, then office, then field. */
export function primaryAssigneeId(team: TeamInput): string | null {
  for (const r of ASSIGNMENT_ROLES) {
    const hit = team.find((t) => t.role === r.value)
    if (hit) return hit.userId
  }
  return null
}
