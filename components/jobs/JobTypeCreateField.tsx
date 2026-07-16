'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { JobTypeSelect } from '@/components/jobs/JobTypeSelect'
import { JOB_TYPES, type JobTypeValue } from '@/lib/jobs/types'

type JobTypeCreateFieldProps = {
  value: string
  onValueChange: (value: string) => void
  className?: string
}

type ScopeState = {
  loading: boolean
  canAccessAll: boolean
  assignedTypes: JobTypeValue[]
}

export function JobTypeCreateField({ value, onValueChange, className }: JobTypeCreateFieldProps) {
  const [scope, setScope] = useState<ScopeState>({
    loading: true,
    canAccessAll: true,
    assignedTypes: [],
  })
  const [choiceOpen, setChoiceOpen] = useState(false)
  const [pendingChoice, setPendingChoice] = useState<string>('')
  const [hasChosen, setHasChosen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = localStorage.getItem('accessToken')
        if (!token) {
          if (!cancelled) setScope({ loading: false, canAccessAll: true, assignedTypes: [] })
          return
        }
        const response = await fetch('/api/auth/permissions', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          if (!cancelled) setScope({ loading: false, canAccessAll: true, assignedTypes: [] })
          return
        }
        const data = await response.json()
        const assignedTypes = Array.isArray(data.assignedJobTypes)
          ? (data.assignedJobTypes as JobTypeValue[])
          : []
        const canAccessAll = Boolean(data.canAccessAllJobTypes)
        if (cancelled) return

        setScope({ loading: false, canAccessAll, assignedTypes })

        if (!canAccessAll && assignedTypes.length === 1) {
          onValueChange(assignedTypes[0])
          setHasChosen(true)
          return
        }

        if (!canAccessAll && assignedTypes.length > 1) {
          setPendingChoice(assignedTypes[0])
          setChoiceOpen(true)
          return
        }

        setHasChosen(true)
      } catch {
        if (!cancelled) setScope({ loading: false, canAccessAll: true, assignedTypes: [] })
      }
    })()
    return () => {
      cancelled = true
    }
    // Only resolve scope once on mount for create forms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const options = useMemo(() => {
    if (scope.canAccessAll || scope.assignedTypes.length === 0) return [...JOB_TYPES]
    return JOB_TYPES.filter((item) => scope.assignedTypes.includes(item.value))
  }, [scope.assignedTypes, scope.canAccessAll])

  const lockedToSingle = !scope.canAccessAll && scope.assignedTypes.length === 1
  const awaitingMultiChoice = !scope.canAccessAll && scope.assignedTypes.length > 1 && !hasChosen

  const confirmChoice = () => {
    if (!pendingChoice) return
    onValueChange(pendingChoice)
    setHasChosen(true)
    setChoiceOpen(false)
  }

  return (
    <>
      <JobTypeSelect
        className={className}
        value={value}
        onValueChange={onValueChange}
        options={options}
        disabled={scope.loading || lockedToSingle || awaitingMultiChoice}
      />

      <Dialog
        open={choiceOpen}
        onOpenChange={(open) => {
          // Require a choice when multiple types are assigned.
          if (!open && !hasChosen) return
          setChoiceOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Please choose a job type</DialogTitle>
            <DialogDescription>
              You are assigned to more than one job type. Choose which type this record should use.
            </DialogDescription>
          </DialogHeader>
          <JobTypeSelect
            value={pendingChoice || options[0]?.value || 'CUSTOM'}
            onValueChange={setPendingChoice}
            options={options}
            showLabel={false}
          />
          <DialogFooter>
            <Button type="button" onClick={confirmChoice} disabled={!pendingChoice}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
