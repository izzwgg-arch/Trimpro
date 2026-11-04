'use client'

import { useEffect, useState } from 'react'
import { JOB_STATUSES, jobStatusHexColors } from '@/lib/jobs/statuses'

export type JobStatusOptionClient = { value: string; label: string; color: string }

const BUILTIN: JobStatusOptionClient[] = JOB_STATUSES.map((s) => ({
  value: s.value,
  label: s.label,
  color: jobStatusHexColors[s.value] || '#64748b',
}))

// One shared fetch for the whole page — the jobs list can render dozens of
// status pickers, so they all read from this cache rather than each fetching.
let cache: JobStatusOptionClient[] | null = null
let inflight: Promise<JobStatusOptionClient[]> | null = null

async function fetchCatalog(): Promise<JobStatusOptionClient[]> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
      const res = await fetch('/api/jobs/statuses', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.statuses) && data.statuses.length) {
          const next = data.statuses as JobStatusOptionClient[]
          cache = next
          return next
        }
      }
    } catch {
      /* fall back to built-ins */
    }
    cache = BUILTIN
    return BUILTIN
  })()
  return inflight
}

/** Reactive job status catalog; starts with the built-ins, then fills in custom ones. */
export function useJobStatuses(): JobStatusOptionClient[] {
  const [list, setList] = useState<JobStatusOptionClient[]>(cache || BUILTIN)
  useEffect(() => {
    let active = true
    fetchCatalog().then((c) => {
      if (active) setList(c)
    })
    return () => {
      active = false
    }
  }, [])
  return list
}

/** Call after statuses are edited in settings so pickers refetch. */
export function invalidateJobStatuses() {
  cache = null
  inflight = null
}
