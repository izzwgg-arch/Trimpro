'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { ASSIGNMENT_ROLES, type AssignmentRole } from '@/lib/assignments/roles'

export type TeamUser = { id: string; firstName: string; lastName: string; role?: string | null }
export type TeamEntry = { userId: string; role: AssignmentRole }

const nameOf = (u?: TeamUser) => (u ? `${u.firstName} ${u.lastName}`.trim() : 'Unknown')

/** Active people who can be assigned (names + account role). Loaded once per page. */
export function useAssignableUsers() {
  const [users, setUsers] = useState<TeamUser[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const res = await fetch('/api/assignments/users', { headers: { Authorization: `Bearer ${token}` } })
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setUsers(data.users || [])
        }
      } catch {
        // The picker simply stays empty; saving is unaffected.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return { users, loading }
}

/**
 * Team picker: Site Managers, Office Workers and Field Workers, several people
 * in each. Any active user can be added to any group.
 */
export function TeamEditor({
  value,
  onChange,
  users,
  disabled,
}: {
  value: TeamEntry[]
  onChange: (next: TeamEntry[]) => void
  users: TeamUser[]
  disabled?: boolean
}) {
  const byId = new Map(users.map((u) => [u.id, u]))
  const taken = new Set(value.map((v) => v.userId))
  const available = users.filter((u) => !taken.has(u.id))

  return (
    <div className="space-y-3">
      {ASSIGNMENT_ROLES.map((role) => {
        const members = value.filter((v) => v.role === role.value)
        return (
          <div key={role.value} className="rounded-md border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">{role.label}</span>
              <span className="text-xs text-gray-400">{members.length}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {members.length === 0 && <span className="text-xs text-gray-400">No one yet</span>}
              {members.map((m) => (
                <span
                  key={m.userId}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-sm text-gray-800"
                >
                  {nameOf(byId.get(m.userId))}
                  {!disabled && (
                    <button
                      type="button"
                      aria-label={`Remove ${nameOf(byId.get(m.userId))}`}
                      onClick={() => onChange(value.filter((v) => v.userId !== m.userId))}
                      className="rounded-full p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {!disabled && (
              <select
                value=""
                onChange={(e) => {
                  const userId = e.target.value
                  if (userId) onChange([...value, { userId, role: role.value }])
                }}
                className="mt-2 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-600"
              >
                <option value="">{`+ Add ${role.singular.toLowerCase()}…`}</option>
                {available.map((u) => (
                  <option key={u.id} value={u.id}>
                    {nameOf(u)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )
      })}
    </div>
  )
}
