'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authFetch } from '@/lib/auth/client'

export type SaveJobDecision = { decision: 'new' | 'existing' | 'none'; jobId: string }

export type OpenJob = { id: string; jobNumber: string; title: string; status: string }

const CLOSED_STATUSES = new Set(['COMPLETED', 'CANCELLED'])

/** The customer's open jobs (not completed or cancelled), newest first. */
export function useClientOpenJobs(clientId: string, enabled = true) {
  const [jobs, setJobs] = useState<OpenJob[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !clientId) {
      setJobs([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
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
  }, [clientId, enabled])

  return { jobs, loading }
}

/**
 * Which job a document goes on.
 * - `existing-only` (saving an estimate): add it to one of the customer's open jobs, or save without a job.
 * - `new-or-existing` (an invoice from a request's estimate): create a new job, or use an open job.
 */
export function SaveJobChoiceDialog({
  open,
  mode,
  recordLabel,
  jobs,
  loading,
  busy,
  description,
  onCancel,
  onChoose,
}: {
  open: boolean
  mode: 'existing-only' | 'new-or-existing'
  recordLabel: 'estimate' | 'invoice'
  jobs: OpenJob[]
  loading: boolean
  busy?: boolean
  description?: string
  onCancel: () => void
  onChoose: (choice: SaveJobDecision) => void
}) {
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState('')

  useEffect(() => {
    if (!open) return
    setPicking(false)
    setPicked('')
  }, [open])

  const label = (j: OpenJob) => `${j.jobNumber} — ${j.title}`
  const count = jobs.length
  const openJobsText = `This customer has ${count} open job${count === 1 ? '' : 's'}.`
  const title =
    mode === 'existing-only' ? `Add this ${recordLabel} to an existing job?` : `Which job is this ${recordLabel} for?`
  const text = loading
    ? 'Checking this customer’s jobs…'
    : mode === 'existing-only'
      ? count > 0
        ? `${openJobsText} Put the ${recordLabel} on one of them, or save it without a job?`
        : `This customer has no open jobs. The ${recordLabel} will be saved without a job.`
      : count > 0
        ? `${openJobsText} Create a new job, or add the ${recordLabel} to an existing one?`
        : `This customer has no open jobs. Create a new job for this ${recordLabel}?`
  const disabled = loading || Boolean(busy)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ? (
              <>
                {description}
                <br />
              </>
            ) : null}
            {text}
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
              <Button type="button" variant="outline" disabled={busy} onClick={() => setPicking(false)}>
                Back
              </Button>
              <Button type="button" disabled={!picked || busy} onClick={() => onChoose({ decision: 'existing', jobId: picked })}>
                {busy ? 'Saving…' : 'Use this job'}
              </Button>
            </>
          ) : (
            <>
              {mode === 'existing-only' ? (
                <Button type="button" variant="outline" disabled={disabled} onClick={() => onChoose({ decision: 'none', jobId: '' })}>
                  Save without a job
                </Button>
              ) : (
                <Button type="button" disabled={disabled} onClick={() => onChoose({ decision: 'new', jobId: '' })}>
                  {busy ? 'Saving…' : 'Create new job'}
                </Button>
              )}
              {count > 0 ? (
                <Button
                  type="button"
                  variant={mode === 'existing-only' ? 'default' : 'outline'}
                  disabled={disabled}
                  onClick={() => setPicking(true)}
                >
                  Use existing job
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
