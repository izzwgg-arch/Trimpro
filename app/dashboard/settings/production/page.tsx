'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronUp, ChevronDown, Save, RotateCcw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePermissions, hasPermission } from '@/hooks/usePermissions'
import { ProductionJobCard, type ProductionJobCardData } from '@/components/production/ProductionJobCard'
import { StageIcon } from '@/components/production/StageIcon'
import {
  buildDefaultProductionConfig,
  mergeProductionConfig,
  PRODUCTION_CARD_FIELDS,
  PRODUCTION_ICONS,
  type ProductionConfig,
  type ProductionStageConfig,
  type ProductionCardFieldKey,
  type ProductionSortKey,
} from '@/lib/production/config'
import { formatJobStatus } from '@/lib/jobs/statuses'

const SORT_OPTIONS: Array<{ value: ProductionSortKey; label: string }> = [
  { value: 'dueDate', label: 'Due Date' },
  { value: 'priority', label: 'Priority' },
  { value: 'createdDate', label: 'Created Date' },
  { value: 'jobNumber', label: 'Job Number' },
  { value: 'client', label: 'Client' },
  { value: 'jobSiteAddress', label: 'Job Site Address' },
  { value: 'assignedUser', label: 'Assigned User' },
  { value: 'lastUpdated', label: 'Last Updated' },
]

const FILTER_LABELS: Record<string, string> = {
  search: 'Search', assignedTo: 'Assigned To', priority: 'Priority', dueDate: 'Due Date',
  client: 'Client', jobType: 'Job Type', jobSiteAddress: 'Job Site Address', status: 'Status', overdue: 'Overdue',
}

const SAMPLE_JOB: ProductionJobCardData = {
  id: 'preview',
  jobNumber: 'JOB-000123',
  title: 'Kitchen & living room trim package',
  status: 'IN_PROGRESS',
  priority: 4,
  jobType: 'INTERIOR_TRIM',
  estimateAmount: 18450,
  invoiceAmount: 9000,
  billingStatus: 'Partially billed',
  poCount: 2,
  scheduledEnd: new Date(Date.now() - 86400000).toISOString(),
  createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
  clientName: 'Noble Builders',
  address: '2 Zlotchev Way, Kiryas Joel',
  assignedNames: ['Yoel', 'Moshe'],
}

export default function ProductionSettingsPage() {
  const router = useRouter()
  const { permissions } = usePermissions()
  const canManage = hasPermission(permissions, 'production.manage')

  const [config, setConfig] = useState<ProductionConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch('/api/production/settings', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setConfig(mergeProductionConfig(data.config))
      setDirty(false)
    } catch (e: any) {
      setConfig(buildDefaultProductionConfig())
      setError('Could not load saved settings; showing defaults.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const update = (fn: (c: ProductionConfig) => ProductionConfig) => {
    setConfig((prev) => (prev ? fn(structuredClone(prev)) : prev))
    setDirty(true)
    setNotice(null)
  }

  const save = async () => {
    if (!config) return
    setSaving(true); setError(null); setNotice(null)
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch('/api/production/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ config }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Failed to save'); return }
      setConfig(mergeProductionConfig(data.config))
      setDirty(false)
      setNotice('Production settings saved.')
    } catch {
      setError('Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  const resetToDefault = async () => {
    if (!canManage) return
    if (!confirm('Reset all Production settings to the defaults derived from your Job Statuses?')) return
    setSaving(true); setError(null)
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch('/api/production/settings', { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Failed to reset'); return }
      setConfig(mergeProductionConfig(data.config))
      setDirty(false)
      setNotice('Reset to defaults.')
    } finally {
      setSaving(false)
    }
  }

  const moveStage = (index: number, dir: -1 | 1) => update((c) => {
    const arr = [...c.stages].sort((a, b) => a.order - b.order)
    const j = index + dir
    if (j < 0 || j >= arr.length) return c
    ;[arr[index], arr[j]] = [arr[j], arr[index]]
    arr.forEach((s, i) => (s.order = i))
    c.stages = arr
    return c
  })

  const setStage = (status: string, patch: Partial<ProductionStageConfig>) => update((c) => {
    c.stages = c.stages.map((s) => (s.status === status ? { ...s, ...patch } : s))
    return c
  })

  const moveField = (index: number, dir: -1 | 1) => update((c) => {
    const arr = [...c.card.fields].sort((a, b) => a.order - b.order)
    const j = index + dir
    if (j < 0 || j >= arr.length) return c
    ;[arr[index], arr[j]] = [arr[j], arr[index]]
    arr.forEach((f, i) => (f.order = i))
    c.card.fields = arr
    return c
  })

  const stageColorForPreview = useMemo(() => {
    const s = config?.stages.find((x) => x.status === SAMPLE_JOB.status)
    return s?.color || '#64748b'
  }, [config])

  const previewJob: ProductionJobCardData = useMemo(() => {
    const s = config?.stages.find((x) => x.status === SAMPLE_JOB.status)
    return { ...SAMPLE_JOB, stage: s?.description, nextAction: s?.nextAction }
  }, [config])

  if (loading || !config) return <div className="p-6 text-sm text-gray-500">Loading production settings…</div>

  const fieldLabel = (k: ProductionCardFieldKey) => PRODUCTION_CARD_FIELDS.find((f) => f.key === k)?.label || k
  const sortedStages = [...config.stages].sort((a, b) => a.order - b.order)
  const sortedFields = [...config.card.fields].sort((a, b) => a.order - b.order)
  const ro = !canManage

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <button onClick={() => router.push('/dashboard/settings')} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Settings
      </button>

      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-2 border-b bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Production Settings</h1>
          <p className="text-sm text-gray-500">Customize how the Production board displays your existing Job Statuses. This never changes Job Status itself.</p>
        </div>
        <div className="flex items-center gap-2">
          {!ro && <Button variant="outline" onClick={resetToDefault} disabled={saving}><RotateCcw className="mr-1 h-4 w-4" />Reset to Default</Button>}
          {!ro && <Button variant="outline" onClick={load} disabled={saving || !dirty}>Cancel</Button>}
          {!ro && <Button onClick={save} disabled={saving || !dirty}><Save className="mr-1 h-4 w-4" />{saving ? 'Saving…' : 'Save Changes'}</Button>}
        </div>
      </div>

      {ro && <div className="mb-3 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800">You can view these settings but need the “Manage Production Settings” permission to change them.</div>}
      {error && <div className="mb-3 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* STAGES / COLUMNS */}
          <Card>
            <CardHeader>
              <CardTitle>Production Stages &amp; Columns</CardTitle>
              <CardDescription>Each stage maps to an existing Job Status (shown as a tag). Rename, recolor, reorder, hide, and set the Next Action — the underlying Job Status never changes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {sortedStages.map((s, i) => (
                <div key={s.status} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col pt-1">
                      <button disabled={ro || i === 0} onClick={() => moveStage(i, -1)} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                      <button disabled={ro || i === sortedStages.length - 1} onClick={() => moveStage(i, 1)} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                    </div>
                    <div className="grid flex-1 gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs text-gray-500">Display Name <span className="ml-1 rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500">{formatJobStatus(s.status)}</span></Label>
                        <Input disabled={ro} value={s.displayName} onChange={(e) => setStage(s.status, { displayName: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs text-gray-500">Next Action</Label>
                        <Input disabled={ro} value={s.nextAction} onChange={(e) => setStage(s.status, { nextAction: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs text-gray-500">Description / Stage</Label>
                        <Input disabled={ro} value={s.description} onChange={(e) => setStage(s.status, { description: e.target.value })} />
                      </div>
                      <div className="flex items-end gap-3">
                        <div>
                          <Label className="text-xs text-gray-500">Color</Label>
                          <div className="flex items-center gap-2">
                            <input disabled={ro} type="color" value={s.color} onChange={(e) => setStage(s.status, { color: e.target.value })} className="h-9 w-10 rounded border" />
                            <Input disabled={ro} value={s.color} onChange={(e) => setStage(s.status, { color: e.target.value })} className="w-24" />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500">Icon</Label>
                          <div className="flex items-center gap-1">
                            <StageIcon name={s.icon} className="h-4 w-4 text-gray-500" />
                            <select disabled={ro} value={s.icon} onChange={(e) => setStage(s.status, { icon: e.target.value })} className="rounded border px-2 py-1.5 text-sm">
                              {PRODUCTION_ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                        <label className="flex items-center gap-1 text-sm"><input disabled={ro} type="checkbox" checked={s.visible} onChange={(e) => setStage(s.status, { visible: e.target.checked })} /> Visible</label>
                        <label className="flex items-center gap-1 text-sm"><input disabled={ro} type="checkbox" checked={s.showJobCount} onChange={(e) => setStage(s.status, { showJobCount: e.target.checked })} /> Show job count</label>
                        <div className="flex items-center gap-1 text-sm">
                          <span className="text-gray-500">Default sort</span>
                          <select disabled={ro} value={s.defaultSort} onChange={(e) => setStage(s.status, { defaultSort: e.target.value as ProductionSortKey })} className="rounded border px-2 py-1 text-sm">
                            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <select disabled={ro} value={s.defaultSortDir} onChange={(e) => setStage(s.status, { defaultSortDir: e.target.value as 'asc' | 'desc' })} className="rounded border px-2 py-1 text-sm">
                            <option value="asc">Asc</option><option value="desc">Desc</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* CARD LAYOUT */}
          <Card>
            <CardHeader>
              <CardTitle>Card Layout &amp; Fields</CardTitle>
              <CardDescription>Control the Production card density, styling, and which Job fields appear (and in what order). Fields use existing Job data — no duplicates are created.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs text-gray-500">Density</Label>
                  <select disabled={ro} value={config.card.density} onChange={(e) => update((c) => { c.card.density = e.target.value as any; return c })} className="w-full rounded border px-2 py-1.5 text-sm">
                    <option value="compact">Compact</option><option value="standard">Standard</option><option value="detailed">Detailed</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Column / card width (px)</Label>
                  <Input disabled={ro} type="number" min={220} max={420} value={config.card.width} onChange={(e) => update((c) => { c.card.width = Number(e.target.value) || 288; return c })} />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Border style</Label>
                  <select disabled={ro} value={config.card.borderStyle} onChange={(e) => update((c) => { c.card.borderStyle = e.target.value as any; return c })} className="w-full rounded border px-2 py-1.5 text-sm">
                    <option value="none">Subtle</option><option value="left-accent">Left accent</option><option value="full">Full border</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                {([
                  ['showStatusBadge', 'Status badge'], ['showNextAction', 'Next Action'], ['emphasizeJobNumber', 'Emphasize Job #'],
                  ['showAddress', 'Address'], ['showAssignedUser', 'Assigned user'], ['showDueDate', 'Due date'],
                  ['accentFromStageColor', 'Accent from stage color'],
                ] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1"><input disabled={ro} type="checkbox" checked={(config.card as any)[k]} onChange={(e) => update((c) => { (c.card as any)[k] = e.target.checked; return c })} /> {label}</label>
                ))}
              </div>
              <div>
                <Label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Card fields (order &amp; visibility)</Label>
                <div className="divide-y rounded-lg border">
                  {sortedFields.map((f, i) => (
                    <div key={f.key} className="flex items-center gap-2 px-3 py-1.5">
                      <div className="flex flex-col">
                        <button disabled={ro || i === 0} onClick={() => moveField(i, -1)} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                        <button disabled={ro || i === sortedFields.length - 1} onClick={() => moveField(i, 1)} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                      </div>
                      <label className="flex flex-1 items-center gap-2 text-sm"><input disabled={ro} type="checkbox" checked={f.visible} onChange={(e) => update((c) => { c.card.fields = c.card.fields.map((x) => x.key === f.key ? { ...x, visible: e.target.checked } : x); return c })} /> {fieldLabel(f.key)}</label>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* FILTERS */}
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>Choose which filter controls appear on the Production board. Uses the existing Job search/query — no separate search system.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4 text-sm">
                {Object.keys(config.filters).map((k) => (
                  <label key={k} className="flex items-center gap-1"><input disabled={ro} type="checkbox" checked={(config.filters as any)[k]} onChange={(e) => update((c) => { (c.filters as any)[k] = e.target.checked; return c })} /> {FILTER_LABELS[k] || k}</label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* AUTOMATION */}
          <Card>
            <CardHeader>
              <CardTitle>Automation</CardTitle>
              <CardDescription>When a Job Status is applied, Production automatically moves the job to its column, updates the stage, and updates the Next Action (always on, because Production is derived from Job Status). Optionally trigger existing Tasks / Notifications.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {sortedStages.map((s) => {
                const a = config.automation[s.status]
                if (!a) return null
                return (
                  <div key={s.status} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm">
                    <span className="min-w-[120px] font-medium text-gray-700">{s.displayName} <span className="font-mono text-[10px] text-gray-400">{formatJobStatus(s.status)}</span></span>
                    <label className="flex items-center gap-1"><input disabled={ro} type="checkbox" checked={a.createTask} onChange={(e) => update((c) => { c.automation[s.status] = { ...c.automation[s.status], createTask: e.target.checked }; return c })} /> Create task</label>
                    {a.createTask && <Input disabled={ro} placeholder="Task title (optional)" value={a.createTaskTitle || ''} onChange={(e) => update((c) => { c.automation[s.status] = { ...c.automation[s.status], createTaskTitle: e.target.value }; return c })} className="h-8 w-56" />}
                    <label className="flex items-center gap-1"><input disabled={ro} type="checkbox" checked={a.notifyAssignedUser} onChange={(e) => update((c) => { c.automation[s.status] = { ...c.automation[s.status], notifyAssignedUser: e.target.checked }; return c })} /> Notify assigned user</label>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>

        {/* LIVE PREVIEW */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader><CardTitle>Live Preview</CardTitle><CardDescription>Updates as you edit.</CardDescription></CardHeader>
            <CardContent>
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between rounded-md px-2 py-1.5 text-white" style={{ backgroundColor: stageColorForPreview }}>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <StageIcon name={config.stages.find((x) => x.status === SAMPLE_JOB.status)?.icon} className="h-4 w-4" />
                    {config.stages.find((x) => x.status === SAMPLE_JOB.status)?.displayName || 'In Progress'}
                  </span>
                  {config.stages.find((x) => x.status === SAMPLE_JOB.status)?.showJobCount && <span className="rounded bg-white/25 px-1.5 text-xs">3</span>}
                </div>
                <div style={{ width: Math.min(config.card.width, 300) }}>
                  <ProductionJobCard job={previewJob} config={config} stageColor={stageColorForPreview} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
