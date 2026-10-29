'use client'

import { useEffect, useState } from 'react'
import { User } from 'lucide-react'

type TeamUser = { id: string; firstName: string; lastName: string }

/**
 * Compact "Assigned to" picker for an estimate. Persists immediately via
 * PATCH /api/estimates/[id]/assignee. Lets the "Assigned to me" list filter work.
 */
export function EstimateAssigneeControl({
  estimateId,
  value,
  onChange,
}: {
  estimateId: string
  value: TeamUser | null
  onChange?: (next: TeamUser | null) => void
}) {
  const [users, setUsers] = useState<TeamUser[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const res = await fetch('/api/schedules/team', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setUsers(data.teamMembers || [])
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (id: string) => {
    setSaving(true)
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/estimates/${estimateId}/assignee`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assignedToId: id || null }),
      })
      if (res.ok) {
        const data = await res.json()
        onChange?.(data?.estimate?.assignedTo ?? null)
      }
    } catch {
      /* ignore */
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <User className="h-4 w-4 text-gray-400" />
      <span className="text-gray-500">Assigned to</span>
      <select
        value={value?.id || ''}
        disabled={saving}
        onChange={(e) => save(e.target.value)}
        className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700"
      >
        <option value="">Unassigned</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.firstName} {u.lastName}
          </option>
        ))}
      </select>
    </div>
  )
}
