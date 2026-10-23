'use client'

import { useEffect, useRef, useState } from 'react'
import { Briefcase } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authFetch } from '@/lib/auth/client'

export type OpenJobsChoice = {
  /** The customer has open jobs, so a choice is needed before saving. */
  required: boolean
  decision: 'new' | 'existing' | null
  jobId: string
  jobLabel: string
}

export const EMPTY_OPEN_JOBS_CHOICE: OpenJobsChoice = { required: false, decision: null, jobId: '', jobLabel: '' }

type OpenJob = { id: string; jobNumber: string; title: string; status: string }

const CLOSED_STATUSES = new Set(['COMPLETED', 'CANCELLED'])

/**
 * When a new estimate's customer already has open jobs, ask whether to start a new
 * job or put the estimate on one of those jobs.
 */
export function OpenJobsPrompt({
  clientId,
  disabled,
  value,
  onChange,
}: {
  clientId: string
  disabled?: boolean
  value: OpenJobsChoice
  onChange: (next: OpenJobsChoice) => void
}) {
  const [jobs, setJobs] = useState<OpenJob[]>([])
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState('')
  const checkedFor = useRef<string | null>(null)

  useEffect(() => {
    if (disabled || !clientId || checkedFor.current === clientId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await authFetch(`/api/jobs?clientId=${encodeURIComponent(clientId)}&limit=100&sortBy=updatedAt&sortDirection=desc`)
        if (!res.ok) return
        const data = await res.json()
        const openJobs: OpenJob[] = (data.jobs || [])
          .filter((j: any) => j.client?.id === clientId || j.clientId === clientId)
          .filter((j: any) => !CLOSED_STATUSES.has(String(j.status || '').toUpperCase()))
          .map((j: any) => ({ id: j.id, jobNumber: j.jobNumber, title: j.title, status: j.status }))
        if (cancelled) return
        checkedFor.current = clientId
        setJobs(openJobs)
        setPicking(false)
        setPicked('')
        if (openJobs.length > 0) {
          onChange({ required: true, decision: null, jobId: '', jobLabel: '' })
          setOpen(true)
        } else {
          onChange(EMPTY_OPEN_JOBS_CHOICE)
        }
      } catch {
        // No prompt if the jobs can't be loaded; the estimate still saves.
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, disabled])

  if (disabled || !value.required) return null

  const label = (j: OpenJob) => `${j.jobNumber} — ${j.title}`

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
        <Briefcase className="h-4 w-4 text-amber-700" />
        {value.decision === 'new' ? (
          <span>A new job will be created for this estimate.</span>
        ) : value.decision === 'existing' ? (
          <span>
            Goes on existing job <b>{value.jobLabel}</b>.
          </span>
        ) : (
          <span className="text-amber-800">This customer has open jobs — choose a new or existing job.</span>
        )}
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setOpen(true)}>
          {value.decision ? 'Change' : 'Choose'}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Customer has open jobs</DialogTitle>
            <DialogDescription>
              We see that this customer has {jobs.length} open job{jobs.length === 1 ? '' : 's'}. Do you want to create a new one?
            </DialogDescription>
          </DialogHeader>

          {picking ? (
            <div className="space-y-2">
              <Label htmlFor="open-job-pick">Please select job</Label>
              <Select value={picked} onValueChange={setPicked}>
                <SelectTrigger id="open-job-pick" className="w-full">
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
                <Button
                  type="button"
                  disabled={!picked}
                  onClick={() => {
                    const job = jobs.find((j) => j.id === picked)
                    if (!job) return
                    onChange({ required: true, decision: 'existing', jobId: job.id, jobLabel: label(job) })
                    setOpen(false)
                  }}
                >
                  Use this job
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setPicking(true)}>
                  Use existing
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    onChange({ required: true, decision: 'new', jobId: '', jobLabel: '' })
                    setOpen(false)
                  }}
                >
                  Create new
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
