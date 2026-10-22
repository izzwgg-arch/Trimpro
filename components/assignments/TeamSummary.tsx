import { ASSIGNMENT_ROLES, buildTeam, type TeamMember } from '@/lib/assignments/roles'

type RawAssignment = Parameters<typeof buildTeam>[0]
type LegacyAssignee = Parameters<typeof buildTeam>[1]

/** Team members for an item (assignment rows plus the legacy single assignee). */
export function teamOf(assignments: RawAssignment, legacyAssignee?: LegacyAssignee): TeamMember[] {
  return buildTeam(assignments, legacyAssignee)
}

/** One-line text for lists: "Jo Smith +2", or "Unassigned". */
export function teamLabel(team: TeamMember[]): string {
  if (team.length === 0) return 'Unassigned'
  const first = `${team[0].user.firstName} ${team[0].user.lastName}`.trim()
  return team.length > 1 ? `${first} +${team.length - 1}` : first
}

/** Read-only team grouped by role. */
export function TeamSummary({ team, className }: { team: TeamMember[]; className?: string }) {
  if (team.length === 0) return <span className={`text-sm text-gray-500 ${className || ''}`}>Unassigned</span>
  return (
    <div className={`space-y-1 text-sm ${className || ''}`}>
      {ASSIGNMENT_ROLES.map((role) => {
        const members = team.filter((m) => m.role === role.value)
        if (members.length === 0) return null
        return (
          <div key={role.value} className="flex flex-wrap gap-x-2">
            <span className="font-medium text-gray-500">{role.label}:</span>
            <span className="text-gray-900">
              {members.map((m) => `${m.user.firstName} ${m.user.lastName}`.trim()).join(', ')}
            </span>
          </div>
        )
      })}
    </div>
  )
}
