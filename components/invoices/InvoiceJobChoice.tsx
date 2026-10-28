'use client'

import { useEffect, useState } from 'react'
import { Briefcase } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SaveJobChoiceDialog, useClientOpenJobs, type SaveJobDecision } from '@/components/estimates/SaveJobChoiceDialog'
import { authFetch } from '@/lib/auth/client'

/**
 * An invoice from a request's estimate that has no job yet (e.g. the customer approved
 * the estimate online): ask for a new job or one of the customer's open jobs. Opens by
 * itself when the page is reached from the "choose a job" alert (?chooseJob=1).
 */
export function InvoiceJobChoice({
  invoiceId,
  clientId,
  canEdit,
  onDone,
}: {
  invoiceId: string
  clientId: string
  canEdit: boolean
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const openJobs = useClientOpenJobs(clientId, canEdit)

  useEffect(() => {
    if (!canEdit) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('chooseJob') === '1') setOpen(true)
  }, [canEdit])

  const choose = async (choice: SaveJobDecision) => {
    setBusy(true)
    try {
      const res = await authFetch(`/api/invoices/${invoiceId}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: choice.decision, jobId: choice.jobId || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || 'Could not put the invoice on a job.')
        return
      }
      setOpen(false)
      const url = new URL(window.location.href)
      if (url.searchParams.has('chooseJob')) {
        url.searchParams.delete('chooseJob')
        window.history.replaceState(null, '', url.toString())
      }
      window.dispatchEvent(new Event('trimpro:notifications-changed'))
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Briefcase className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">This invoice isn’t on a job yet</div>
            <div className="text-sm">Its estimate came from a request. Create a new job or put it on an existing job.</div>
          </div>
        </div>
        {canEdit ? (
          <Button type="button" onClick={() => setOpen(true)}>
            Choose job
          </Button>
        ) : null}
      </div>
      <SaveJobChoiceDialog
        open={open}
        mode="new-or-existing"
        recordLabel="invoice"
        jobs={openJobs.jobs}
        loading={openJobs.loading}
        busy={busy}
        onCancel={() => setOpen(false)}
        onChoose={(choice) => void choose(choice)}
      />
    </>
  )
}
