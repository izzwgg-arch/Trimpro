'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { PipelineBoardKey, PipelineConfig, PipelineStageConfig } from '@/lib/production/pipelines'

/**
 * Company settings for the Estimate and Invoice pipelines: stage names, colors,
 * order and default next actions, hold reasons, follow-up rule, and what the All
 * Work overview includes. Stages always map to the same real statuses — only how
 * they look changes. The Jobs production line settings are separate and untouched.
 */
export function PipelineSettingsDialog({
  open,
  onOpenChange,
  config,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: PipelineConfig
  onSave: (config: PipelineConfig) => Promise<void>
}) {
  const [draft, setDraft] = useState<PipelineConfig>(config)
  const [board, setBoard] = useState<PipelineBoardKey>('estimates')
  const [reasons, setReasons] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(JSON.parse(JSON.stringify(config)))
    setReasons(config.holdReasons.join('\n'))
    setError(null)
  }, [open, config])

  const stages = draft[board].stages
  const setStages = (next: PipelineStageConfig[]) =>
    setDraft((d) => ({ ...d, [board]: { stages: next.map((s, i) => ({ ...s, order: i })) } }))
  const patchStage = (id: string, patch: Partial<PipelineStageConfig>) =>
    setStages(stages.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= stages.length) return
    const next = [...stages]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setStages(next)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave({
        ...draft,
        holdReasons: reasons.split('\n').map((r) => r.trim()).filter(Boolean),
      })
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || 'Could not save the settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pipeline settings</DialogTitle>
          <DialogDescription>
            How the Estimates and Invoices pipelines look for everyone. Each stage always follows the same real status — renaming a stage
            never changes a record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <div className="flex gap-1 border-b">
            {(['estimates', 'invoices'] as PipelineBoardKey[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBoard(b)}
                className={`border-b-2 px-3 py-1.5 font-medium ${board === b ? 'border-[var(--brand-primary-color)] text-[var(--brand-primary-color)]' : 'border-transparent text-gray-500'}`}
              >
                {b === 'estimates' ? 'Estimate stages' : 'Invoice stages'}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {stages.map((s, idx) => (
              <div key={s.id} className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-md border p-2 sm:grid-cols-[auto_1fr_1.4fr_auto]">
                <input
                  type="color"
                  aria-label={`${s.label} color`}
                  value={s.color}
                  onChange={(e) => patchStage(s.id, { color: e.target.value })}
                  className="mt-1 h-8 w-8 cursor-pointer rounded border"
                />
                <Input value={s.label} onChange={(e) => patchStage(s.id, { label: e.target.value })} aria-label="Stage name" />
                <Input
                  value={s.defaultNextAction}
                  onChange={(e) => patchStage(s.id, { defaultNextAction: e.target.value })}
                  placeholder="Default next action"
                  aria-label="Default next action"
                  className="col-span-2 sm:col-span-1"
                />
                <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
                  <label className="mr-1 flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" checked={s.visible} onChange={(e) => patchStage(s.id, { visible: e.target.checked })} />
                    Show
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up">
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => move(idx, 1)} disabled={idx === stages.length - 1} aria-label="Move down">
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="pl-reasons">Hold reasons (one per line)</Label>
              <Textarea id="pl-reasons" rows={6} value={reasons} onChange={(e) => setReasons(e.target.value)} className="mt-1" />
              <p className="mt-1 text-xs text-gray-500">People can always type another reason.</p>
            </div>
            <div className="space-y-4">
              <div>
                <Label htmlFor="pl-days">Suggest a follow-up this many days after a hold</Label>
                <Input
                  id="pl-days"
                  type="number"
                  min={0}
                  max={90}
                  value={draft.holdFollowUpDays}
                  onChange={(e) => setDraft((d) => ({ ...d, holdFollowUpDays: Number(e.target.value) }))}
                  className="mt-1 w-28"
                />
              </div>
              <div>
                <Label>All Work shows</Label>
                <div className="mt-1 space-y-1">
                  {(['jobs', 'estimates', 'invoices', 'tasks', 'requests'] as const).map((k) => (
                    <label key={k} className="flex items-center gap-2 capitalize">
                      <input
                        type="checkbox"
                        checked={draft.allWork[k]}
                        onChange={(e) => setDraft((d) => ({ ...d, allWork: { ...d.allWork, [k]: e.target.checked } }))}
                      />
                      {k}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
