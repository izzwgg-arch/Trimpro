'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authFetch } from '@/lib/auth/client'

export type SaveJobDecision = { decision: 'new' | 'existing' | 'none'; jobId: string }

type OpenJob = { id: string; jobNumber: string; title: string; status: string }

const CLOSED_STATUSES = new Set(['COMPLETED', 'CANCELLED'])

/**
 * Asked when saving an estimate that came from a request: put it on a new job or on
 * one of the customer's open jobs. With no open jobs the choice is a new job or no
 * job (the same as before this question existed).
 */
export function SaveJobChoiceDialog({
  open,
  clientId,
  onCancel,
  onChoose,
}: {
  open: boolean
  clientId: string
  onCancel: () => void
  onChoose: (choice: SaveJobDecision) => void
}) {
  const [jobs, setJobs] = useState<OpenJob[]>([])
  const [loading, setLoading] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState('')

  useEffect(() => {
    if (!open || !clientId) return
    let cancelled = false
    setLoading(true)
    setPicking(false)
    setPicked('')
    ;(async () => {
      try {
        const res = await authFetch(`/api/jobs?clientId=${encodeURIComponent(clientId)}&limit=100&sortBy=updatedAt&sortDirection=desc`)
        const data = res.ok ? await res.json() : { jobs: [] }
        if (cancelled) return
        setJobs(
          (data.jobs || [])
            .filter((j: any) => j.client?.id === clientId || j.clientId === clientId)
            .filter((j: any) => !CLOSED_STATUSES.has(String(j.status || '').toUpperCase()))
            .map((j: any) => ({ id: j.id, jobNumber: j.jobNumber, title: j.title, status: j.status }))
        )
      } catch {
        if (!cancelled) setJobs([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, clientId])

  const label = (j: OpenJob) => `${j.jobNumber} — ${j.title}`

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Which job is this estimate for?</DialogTitle>
          <DialogDescription>
            {loading
              ? 'Checking this customer’s jobs…'
              : jobs.length > 0
                ? `This customer has ${jobs.length} open job${jobs.length === 1 ? '' : 's'}. Create a new job, or put the estimate on an existing one?`
                : 'This customer has no open jobs. Create a new job for this estimate?'}
          </DialogDescription>
        </DialogHeader>

        {picking ? (
          <div className="space-y-2">
            <Label htmlFor="save-job-pick">Please select job</Label>
            <Select value={picked} onValueChange={setPicked}>
              <SelectTrigger id="save-job-pick" className="w-full">
                <SelectValue placeholder="Please select job" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {label(j)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          {picking ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPicking(false)}>
                Back
              </Button>
              <Button type="button" disabled={!picked} onClick={() => onChoose({ decision: 'existing', jobId: picked })}>
                Use this job and save
              </Button>
            </>
          ) : (
            <>
              {jobs.length > 0 ? (
                <Button type="button" variant="outline" disabled={loading} onClick={() => setPicking(true)}>
                  Use existing job
                </Button>
              ) : (
                <Button type="button" variant="outline" disabled={loading} onClick={() => onChoose({ decision: 'none', jobId: '' })}>
                  Save without a job
                </Button>
              )}
              <Button type="button" disabled={loading} onClick={() => onChoose({ decision: 'new', jobId: '' })}>
                Create new job and save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
