'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { authFetch } from '@/lib/auth/client'
import { hasPermission, usePermissions } from '@/hooks/usePermissions'
import { formatDateTime } from '@/lib/utils'

type Row = { id: string; title: string; updatedAt: string; createdBy: string; doorCount: number; itemCount: number }

/** "Material Takeoff" box on the job page: the job's takeoffs and a button to start one. */
export function JobTakeoffsCard({ jobId }: { jobId: string }) {
  const router = useRouter()
  const { permissions } = usePermissions()
  const canView = hasPermission(permissions, 'jobs.takeoffs.view')
  const canCreate = hasPermission(permissions, 'jobs.takeoffs.create')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch(`/api/jobs/${jobId}/takeoffs`)
    if (!res.ok) {
      setRows([])
      return
    }
    const data = await res.json()
    setRows(data.takeoffs || [])
  }, [jobId])

  useEffect(() => {
    if (canView) void load()
  }, [canView, load])

  if (!canView) return null

  const create = async () => {
    setCreating(true)
    setError(null)
    try {
      const res = await authFetch(`/api/jobs/${jobId}/takeoffs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not start a takeoff')
        return
      }
      router.push(`/dashboard/jobs/${jobId}/takeoffs/${data.takeoff.id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          Material Takeoff
        </CardTitle>
        {canCreate ? (
          <Button size="sm" onClick={create} disabled={creating}>
            <Plus className="mr-1 h-4 w-4" />
            {creating ? 'Starting…' : rows && rows.length > 0 ? 'New' : 'Start Takeoff'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {rows === null ? <p className="text-sm text-gray-500">Loading…</p> : null}
        {rows && rows.length === 0 ? <p className="text-sm text-gray-500">No takeoff for this job yet.</p> : null}
        {(rows || []).map((r, i) => (
          <Link
            key={r.id}
            href={`/dashboard/jobs/${jobId}/takeoffs/${r.id}`}
            className="block rounded-lg border p-3 hover:bg-gray-50"
          >
            <p className="text-sm font-medium">{r.title || `Takeoff ${i + 1}`}</p>
            <p className="text-xs text-gray-600">
              {r.doorCount} door{r.doorCount === 1 ? '' : 's'} · {r.itemCount} material{r.itemCount === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-gray-400">
              Updated {formatDateTime(r.updatedAt)}
              {r.createdBy ? ` · by ${r.createdBy}` : ''}
            </p>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
