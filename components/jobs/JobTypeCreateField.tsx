'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { JobTypeSelect } from '@/components/jobs/JobTypeSelect'
import { JOB_TYPES, type JobTypeValue } from '@/lib/jobs/types'

type JobTypeCreateFieldProps = {
  value: string
  onValueChange: (value: string) => void
  className?: string
  /** Kept for older callers; the prompt copy no longer depends on it. */
  forcePrompt?: boolean
  /**
   * Ask for the job type in a pop-up as soon as the form opens (default true). Pass
   * false when the type is already known (e.g. it came from a request or estimate).
   */
  ask?: boolean
  /** What is being created, for the pop-up text (e.g. "estimate"). */
  recordLabel?: string
}

type ScopeState = {
  loading: boolean
  canAccessAll: boolean
  assignedTypes: JobTypeValue[]
}

/**
 * Job type field for create forms. Pops up "which job type?" with one button per
 * type the person may use; someone limited to a single type gets it filled in.
 */
export function JobTypeCreateField({
  value,
  onValueChange,
  className,
  ask = true,
  recordLabel = 'record',
}: JobTypeCreateFieldProps) {
  const [scope, setScope] = useState<ScopeState>({ loading: true, canAccessAll: true, assignedTypes: [] })
  const [choiceOpen, setChoiceOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let canAccessAll = true
      let assignedTypes: JobTypeValue[] = []
      try {
        const token = localStorage.getItem('accessToken')
        const response = token
          ? await fetch('/api/auth/permissions', { headers: { Authorization: `Bearer ${token}` } })
          : null
        if (response?.ok) {
          const data = await response.json()
          assignedTypes = Array.isArray(data.assignedJobTypes) ? (data.assignedJobTypes as JobTypeValue[]) : []
          canAccessAll = Boolean(data.canAccessAllJobTypes)
        }
      } catch {
        // Fall back to offering every type.
      }
      if (cancelled) return
      setScope({ loading: false, canAccessAll, assignedTypes })
      if (!ask || value) return
      // Locked to exactly one type: no need to ask.
      if (!canAccessAll && assignedTypes.length === 1) {
        onValueChange(assignedTypes[0])
        return
      }
      setChoiceOpen(true)
    })()
    return () => {
      cancelled = true
    }
    // Resolve once when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask])

  const options = useMemo(() => {
    if (scope.canAccessAll || scope.assignedTypes.length === 0) return [...JOB_TYPES]
    return JOB_TYPES.filter((item) => scope.assignedTypes.includes(item.value))
  }, [scope.assignedTypes, scope.canAccessAll])

  const lockedToSingle = !scope.canAccessAll && scope.assignedTypes.length === 1

  return (
    <>
      <JobTypeSelect
        className={className}
        value={value}
        onValueChange={onValueChange}
        options={options}
        disabled={scope.loading || lockedToSingle}
      />

      <Dialog
        open={choiceOpen}
        onOpenChange={(open) => {
          // A type has to be picked before the pop-up closes.
          if (!open && !value) return
          setChoiceOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Which job type?</DialogTitle>
            <DialogDescription>Choose the job type for this {recordLabel}.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {options.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant={value === item.value ? 'default' : 'outline'}
                className="h-14 text-base"
                onClick={() => {
                  onValueChange(item.value)
                  setChoiceOpen(false)
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
