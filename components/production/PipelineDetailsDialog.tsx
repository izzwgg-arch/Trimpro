'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { PipelineItem } from '@/lib/production/pipeline-data'
import type { PipelineConfig } from '@/lib/production/pipelines'
import { RecordTypeBadge, RelatedChip, shortDate, statusWord } from '@/components/production/PipelineCard'

type Person = { id: string; firstName: string; lastName: string }

const OTHER = '__other__'
const toDay = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
function addDays(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Hold, responsible person, next action, follow-up and notes for one estimate or
 * invoice. Only offers what the record's real status allows (e.g. no hold on a paid
 * invoice, review steps only on drafts). Never changes the record's own status.
 */
export function PipelineDetailsDialog({
  item,
  open,
  onOpenChange,
  config,
  people,
  onSave,
  onOpenRelated,
}: {
  item: PipelineItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  config: PipelineConfig
  people: Person[]
  onSave: (item: PipelineItem, changes: Record<string, unknown>) => Promise<void>
  onOpenRelated: (href: string) => void
}) {
  const [onHold, setOnHold] = useState(false)
  const [reasonChoice, setReasonChoice] = useState('')
  const [reasonOther, setReasonOther] = useState('')
  const [reviewStage, setReviewStage] = useState<string>('')
  const [disputed, setDisputed] = useState(false)
  const [responsibleId, setResponsibleId] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !item) return
    const reason = item.hold.reason || ''
    const known = config.holdReasons.includes(reason)
    setOnHold(item.hold.onHold)
    setReasonChoice(reason ? (known ? reason : OTHER) : '')
    setReasonOther(reason && !known ? reason : '')
    setReviewStage(item.reviewStage || '')
    setDisputed(item.disputed)
    setResponsibleId(item.responsible && !item.responsible.isDefault ? item.responsible.id : '')
    setNextAction(item.nextActionIsDefault ? '' : item.nextAction || '')
    setFollowUp(toDay(item.followUpDate))
    setNotes(item.notes || '')
    setError(null)
  }, [open, item, config.holdReasons])

  if (!item) return null
  const canEdit = item.allowed.edit
  const holdReason = reasonChoice === OTHER ? reasonOther.trim() : reasonChoice
  const defaultNext = config[item.type === 'ESTIMATE' ? 'estimates' : 'invoices'].stages.find((s) => s.id === item.stage)?.defaultNextAction

  const toggleHold = (next: boolean) => {
    setOnHold(next)
    if (next && !followUp && config.holdFollowUpDays > 0) setFollowUp(addDays(config.holdFollowUpDays))
  }

  const save = async () => {
    if (onHold && !holdReason) {
      setError('Pick or type a hold reason.')
      return
    }
    const changes: Record<string, unknown> = {
      responsibleUserId: responsibleId || null,
      nextAction: nextAction.trim() || null,
      followUpDate: followUp || null,
      notes,
    }
    if (item.allowed.hold || item.hold.onHold) {
      changes.onHold = onHold
      if (onHold) changes.holdReason = holdReason
    }
    if (item.allowed.review || item.reviewStage) changes.reviewStage = item.allowed.review ? reviewStage || null : null
    if (item.allowed.dispute || item.disputed) changes.disputed = item.allowed.dispute ? disputed : false
    setSaving(true)
    setError(null)
    try {
      await onSave(item, changes)
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const reviewLabel = (id: string) =>
    config[item.type === 'ESTIMATE' ? 'estimates' : 'invoices'].stages.find((s) => s.id === id)?.label || id

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <RecordTypeBadge type={item.type} />
            <span className="font-mono">{item.number}</span>
          </DialogTitle>
          <DialogDescription>
            {item.title}
            {item.client ? ` · ${item.client.name}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded px-2 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: item.stageColor }}>
              {item.stageLabel}
            </span>
            <span className="text-xs text-gray-500">
              Status: <span className="font-medium text-gray-700">{statusWord(item.status)}</span>
            </span>
            <button type="button" className="ml-auto text-xs font-semibold text-blue-700 hover:underline" onClick={() => onOpenRelated(item.href)}>
              Open {item.type === 'ESTIMATE' ? 'estimate' : 'invoice'}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            The stage follows the {item.type === 'ESTIMATE' ? "estimate's status" : "invoice's status and payments"}. Sending,
            approving and payments are done on the {item.type === 'ESTIMATE' ? 'estimate' : 'invoice'} itself.
          </p>
          {item.ignoredManual ? (
            <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              &ldquo;{reviewLabel(item.ignoredManual)}&rdquo; no longer applies — the {item.type === 'ESTIMATE' ? 'estimate' : 'invoice'} is now{' '}
              {statusWord(item.status).toLowerCase()}.
            </p>
          ) : null}

          {(item.related.job || item.related.estimate || item.related.invoices.length > 0) && (
            <div>
              <Label className="text-xs text-gray-500">Linked records</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.related.estimate ? (
                  <RelatedChip label={`Estimate ${item.related.estimate.estimateNumber}`} onClick={() => onOpenRelated(`/dashboard/estimates/${item.related.estimate!.id}`)} />
                ) : null}
                {item.related.job ? (
                  <RelatedChip label={`Job ${item.related.job.jobNumber}`} onClick={() => onOpenRelated(`/dashboard/jobs/${item.related.job!.id}`)} />
                ) : null}
                {item.related.invoices.map((i) => (
                  <RelatedChip key={i.id} label={`Invoice ${i.invoiceNumber} · ${statusWord(i.status)}`} onClick={() => onOpenRelated(`/dashboard/invoices/${i.id}`)} />
                ))}
              </div>
            </div>
          )}

          {!canEdit ? (
            <p className="rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">
              You can view this, but changing it needs permission to edit {item.type === 'ESTIMATE' ? 'estimates' : 'invoices'}.
            </p>
          ) : null}

          {item.allowed.review ? (
            <div>
              <Label htmlFor="pl-review">Draft step</Label>
              <select
                id="pl-review"
                disabled={!canEdit}
                value={reviewStage}
                onChange={(e) => setReviewStage(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
              >
                <option value="">{reviewLabel('DRAFT')}</option>
                <option value="INTERNAL_REVIEW">{reviewLabel('INTERNAL_REVIEW')}</option>
                <option value="READY_TO_SEND">{reviewLabel('READY_TO_SEND')}</option>
              </select>
            </div>
          ) : null}

          {item.allowed.hold || item.hold.onHold ? (
            <div className="rounded-md border p-3">
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" disabled={!canEdit} checked={onHold} onChange={(e) => toggleHold(e.target.checked)} />
                On hold
              </label>
              {onHold ? (
                <div className="mt-2 space-y-2">
                  <select
                    aria-label="Hold reason"
                    disabled={!canEdit}
                    value={reasonChoice}
                    onChange={(e) => setReasonChoice(e.target.value)}
                    className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                  >
                    <option value="">Choose a reason…</option>
                    {config.holdReasons.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    <option value={OTHER}>Other…</option>
                  </select>
                  {reasonChoice === OTHER ? (
                    <Input disabled={!canEdit} value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} placeholder="Hold reason" />
                  ) : null}
                </div>
              ) : null}
              {item.hold.heldAt || item.hold.releasedAt ? (
                <p className="mt-2 text-xs text-gray-500">
                  {item.hold.heldAt ? `Placed on hold ${shortDate(item.hold.heldAt)}` : ''}
                  {item.hold.releasedAt && !item.hold.onHold ? `${item.hold.heldAt ? ' · ' : ''}Released ${shortDate(item.hold.releasedAt)}` : ''}
                </p>
              ) : null}
            </div>
          ) : null}

          {item.allowed.dispute || item.disputed ? (
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" disabled={!canEdit || !item.allowed.dispute} checked={disputed} onChange={(e) => setDisputed(e.target.checked)} />
              Disputed by the client
            </label>
          ) : null}

          <div>
            <Label htmlFor="pl-responsible">Responsible</Label>
            <select
              id="pl-responsible"
              disabled={!canEdit}
              value={responsibleId}
              onChange={(e) => setResponsibleId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
            >
              <option value="">
                {item.responsible?.isDefault ? `Default — ${item.responsible.name}` : 'Nobody picked'}
              </option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${p.firstName} ${p.lastName}`.trim()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="pl-next">Next action</Label>
            <Input
              id="pl-next"
              disabled={!canEdit}
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder={defaultNext || 'What happens next?'}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="pl-follow">Follow-up date</Label>
            <Input id="pl-follow" type="date" disabled={!canEdit} value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label htmlFor="pl-notes">Internal notes</Label>
            <Textarea id="pl-notes" disabled={!canEdit} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1" />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {canEdit ? 'Cancel' : 'Close'}
          </Button>
          {canEdit ? (
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
