/** Prisma `where` fragment: tasks/issues where this person is the primary assignee or on the team. */
export function assignedToUserWhere(userId: string): { OR: any[] } {
  return { OR: [{ assigneeId: userId }, { assignments: { some: { userId } } }] }
}

/** Search clause: a team member's name matches the term (use inside a task/issue search OR list). */
export function teamMemberNameClauses(ilike: (term: string) => any, term: string) {
  return [
    { assignments: { some: { user: { firstName: ilike(term) } } } },
    { assignments: { some: { user: { lastName: ilike(term) } } } },
  ]
}

/** Prisma include for a task/issue team (members + their account role for default role labels). */
export const teamInclude = {
  assignments: {
    include: {
      user: { select: { id: true, firstName: true, lastName: true, role: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
}
