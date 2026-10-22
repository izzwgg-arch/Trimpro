// Team roles for jobs, tasks and issues. Mirrors lib/assignments/roles.ts on the web.
export const ASSIGNMENT_ROLES = [
  { value: 'SITE_MANAGER', label: 'Site Managers', singular: 'Site Manager' },
  { value: 'OFFICE_WORKER', label: 'Office Workers', singular: 'Office Worker' },
  { value: 'FIELD_WORKER', label: 'Field Workers', singular: 'Field Worker' },
] as const

export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number]['value']

const ROLE_VALUES = new Set<string>(ASSIGNMENT_ROLES.map((r) => r.value))

export function defaultRoleForUser(accountRole?: string | null): AssignmentRole {
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

export function normalizeAssignmentRole(role?: string | null, accountRole?: string | null): AssignmentRole {
  return role && ROLE_VALUES.has(role) ? (role as AssignmentRole) : defaultRoleForUser(accountRole)
}

export type TeamMember = { userId: string; name: string; role: AssignmentRole }
export type TeamEntry = { userId: string; role: AssignmentRole }

type RawUser = { id: string; firstName?: string | null; lastName?: string | null; role?: string | null }
type RawAssignment = { userId?: string; role?: string | null; user?: RawUser | null }

const fullName = (u: RawUser) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown'

/** A team from assignment rows, plus the legacy single assignee when they have no row yet. */
export function buildTeam(assignments?: RawAssignment[] | null, legacyAssignee?: RawUser | null): TeamMember[] {
  const team: TeamMember[] = []
  const seen = new Set<string>()
  for (const a of assignments || []) {
    const user = a?.user
    if (!user?.id || seen.has(user.id)) continue
    seen.add(user.id)
    team.push({ userId: user.id, name: fullName(user), role: normalizeAssignmentRole(a.role, user.role) })
  }
  if (legacyAssignee?.id && !seen.has(legacyAssignee.id)) {
    team.push({
      userId: legacyAssignee.id,
      name: fullName(legacyAssignee),
      role: defaultRoleForUser(legacyAssignee.role),
    })
  }
  return team
}
