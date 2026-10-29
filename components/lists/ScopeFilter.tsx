'use client'

// "Created by me / Assigned to me / Both" list filter control. Pages keep the
// value in state and pass it to their API fetch as `?scope=`. See
// lib/list-scope/created-assigned.ts for the server side.

export type ListScope = 'all' | 'created' | 'assigned' | 'both'

export const DEFAULT_SCOPE_SELECT_CLASS =
  'h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700'

export function ScopeFilter({
  value,
  onChange,
  className,
}: {
  value: ListScope
  onChange: (v: ListScope) => void
  className?: string
}) {
  return (
    <select
      aria-label="Ownership"
      value={value}
      onChange={(e) => onChange(e.target.value as ListScope)}
      className={className || DEFAULT_SCOPE_SELECT_CLASS}
    >
      <option value="all">All</option>
      <option value="created">Created by me</option>
      <option value="assigned">Assigned to me</option>
      <option value="both">Created &amp; assigned to me</option>
    </select>
  )
}
