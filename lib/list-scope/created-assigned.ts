// Shared "Created by me / Assigned to me / Both" list filter.
//
// Every list route that supports this filter reads a `scope` query param and
// AND-s the resulting fragment into its existing `where`. The fragment is purely
// additive: `scope=all` (or missing) narrows nothing, so any base scoping the
// route already applies (assigned_only, job-type scope, etc.) still holds.

export type CreatedAssignedScope = 'all' | 'created' | 'assigned' | 'both'

export function normalizeScope(value: string | null | undefined): CreatedAssignedScope {
  switch (value) {
    case 'created':
      return 'created'
    case 'assigned':
      return 'assigned'
    case 'both':
      return 'both'
    default:
      return 'all'
  }
}

/**
 * Build a Prisma `where` fragment for the chosen scope, or `null` when the scope
 * narrows nothing (so callers can skip pushing it).
 *
 * @param createdClause  matches records this user created (e.g. `{ createdById: userId }`)
 * @param assignedClause matches records assigned to this user (e.g. `assignedToUserWhere(userId)`)
 */
export function scopeWhere(
  scope: CreatedAssignedScope,
  createdClause: any | null,
  assignedClause: any | null
): any | null {
  switch (scope) {
    case 'created':
      return createdClause ?? null
    case 'assigned':
      return assignedClause ?? null
    case 'both': {
      const ors = [createdClause, assignedClause].filter(Boolean)
      if (ors.length === 0) return null
      if (ors.length === 1) return ors[0]
      return { OR: ors }
    }
    default:
      return null
  }
}
