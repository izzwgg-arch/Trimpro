'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, PauseCircle, Search, Settings2, SlidersHorizontal } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { StatusBoard } from '@/components/production/StatusBoard'
import { CustomizeViewDialog } from '@/components/production/CustomizeViewDialog'
import { PipelineCard, RecordTypeBadge, RelatedChip, daysLabel, shortDate, statusWord } from '@/components/production/PipelineCard'
import { PipelineDetailsDialog } from '@/components/production/PipelineDetailsDialog'
import { PipelineSettingsDialog } from '@/components/production/PipelineSettingsDialog'
import { authFetch } from '@/lib/auth/client'
import { formatCurrency } from '@/lib/utils'
import { applyBoardPref, type BoardViewPref, type ProductionViewPrefs } from '@/lib/production/view-preferences'
import { buildDefaultPipelineConfig, type PipelineConfig } from '@/lib/production/pipelines'
import type { PipelineItem } from '@/lib/production/pipeline-data'

export type PipelineTab = 'estimates' | 'invoices' | 'all'
type Person = { id: string; firstName: string; lastName: string }

interface Filters {
  type: 'all' | PipelineItem['type']
  stage: string
  client: string
  address: string
  employee: string
  hold: 'all' | 'held' | 'not'
  followUp: 'all' | 'overdue'
  from: string
  to: string
}
const EMPTY: Filters = { type: 'all', stage: 'all', client: 'all', address: '', employee: 'all', hold: 'all', followUp: 'all', from: '', to: '' }

const selectClass = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm'

/**
 * Estimates pipeline, Invoices pipeline and the All Work overview. A separate view
 * from the Jobs production line: it never renders or changes job columns.
 */
export function PipelinesView({
  tab,
  viewPrefs,
  onSavePref,
  canManage,
  onOpen,
}: {
  tab: PipelineTab
  viewPrefs: ProductionViewPrefs
  onSavePref: (board: 'estimates' | 'invoices', pref: BoardViewPref) => void | Promise<void>
  canManage: boolean
  onOpen: (href: string) => void
}) {
  const [items, setItems] = useState<PipelineItem[]>([])
  const [config, setConfig] = useState<PipelineConfig>(buildDefaultPipelineConfig())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [people, setPeople] = useState<Person[]>([])
  const [managing, setManaging] = useState<PipelineItem | null>(null)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Filters belong to one view; switching tabs starts clean.
  useEffect(() => {
    setFilters(EMPTY)
  }, [tab])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({ board: tab })
      if (debounced) params.set('search', debounced)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      const res = await authFetch(`/api/production/pipelines?${params.toString()}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoadError(data?.error || 'Could not load this view.')
        setItems([])
        return
      }
      setItems(data.items || [])
      if (data.config) setConfig(data.config)
    } catch {
      setLoadError('Could not load this view. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [tab, debounced, filters.from, filters.to])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await authFetch('/api/schedules/team')
        if (res.ok) setPeople(((await res.json()).teamMembers || []) as Person[])
      } catch {}
    })()
  }, [])

  const boardKey = tab === 'all' ? null : tab
  const stageDefs = useMemo(() => {
    if (!boardKey) return []
    return [...config[boardKey].stages].filter((s) => s.visible).sort((a, b) => a.order - b.order)
  }, [config, boardKey])

  // Choices for the filter menus come from what's loaded.
  const options = useMemo(() => {
    const clients = new Map<string, string>()
    const employees = new Map<string, string>()
    const stages = new Map<string, string>()
    for (const it of items) {
      if (it.client) clients.set(it.client.id, it.client.name)
      if (it.responsible) employees.set(it.responsible.id, it.responsible.name)
      stages.set(`${it.type}:${it.stage}`, it.stageLabel)
    }
    const sorted = (m: Map<string, string>) => Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
    return { clients: sorted(clients), employees: sorted(employees), stages: sorted(stages) }
  }, [items])

  const visible = useMemo(() => {
    const addr = filters.address.trim().toLowerCase()
    return items.filter((it) => {
      if (filters.type !== 'all' && it.type !== filters.type) return false
      if (filters.stage !== 'all' && `${it.type}:${it.stage}` !== filters.stage) return false
      if (filters.client !== 'all' && it.client?.id !== filters.client) return false
      if (addr && !(it.jobSiteAddress || '').toLowerCase().includes(addr)) return false
      if (filters.employee !== 'all' && it.responsible?.id !== filters.employee) return false
      if (filters.hold === 'held' && !it.hold.onHold) return false
      if (filters.hold === 'not' && it.hold.onHold) return false
      if (filters.followUp === 'overdue' && !it.followUpOverdue) return false
      return true
    })
  }, [items, filters])

  const columns = useMemo(() => {
    if (!boardKey) return []
    const cols = stageDefs.map((s) => ({ id: s.id, label: s.label, color: s.color, icon: s.icon }))
    return applyBoardPref(cols, viewPrefs[boardKey])
  }, [stageDefs, viewPrefs, boardKey])

  const itemsByColumn = useMemo(() => {
    const m: Record<string, PipelineItem[]> = {}
    for (const c of columns) m[c.id] = []
    for (const it of visible) (m[it.stage] = m[it.stage] || []).push(it)
    // Most urgent first: overdue follow-ups, then longest in the stage.
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => Number(b.followUpOverdue) - Number(a.followUpOverdue) || (b.daysInStage ?? 0) - (a.daysInStage ?? 0))
    }
    return m
  }, [visible, columns])

  const hiddenStageCount = boardKey ? visible.filter((it) => !columns.some((c) => c.id === it.stage)).length : 0

  const saveState = async (item: PipelineItem, changes: Record<string, unknown>) => {
    const res = await authFetch('/api/production/pipelines/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordType: item.type, recordId: item.id, ...changes }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Could not save.')
    await load()
  }

  const saveSettings = async (next: PipelineConfig) => {
    const res = await authFetch('/api/production/pipelines/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: next }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Could not save the settings.')
    setConfig(data.config)
    await load()
  }

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const activeCount = (Object.keys(EMPTY) as Array<keyof Filters>).filter((k) => filters[k] !== EMPTY[k]).length
  const heldCount = visible.filter((i) => i.hold.onHold).length
  const followUpCount = visible.filter((i) => i.followUpOverdue).length

  return (
    <>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder={
                  tab === 'estimates'
                    ? 'Search estimates by #, title, client, job or address…'
                    : tab === 'invoices'
                      ? 'Search invoices by #, title, client, job or address…'
                      : 'Search jobs, estimates and invoices…'
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            {boardKey ? (
              <Button variant="ghost" size="sm" onClick={() => setCustomizeOpen(true)}>
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Customize
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="mr-2 h-4 w-4" />
                Pipeline settings
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'all' ? (
              <select aria-label="Record type" value={filters.type} onChange={(e) => set({ type: e.target.value as Filters['type'], stage: 'all' })} className={selectClass}>
                <option value="all">All types</option>
                <option value="JOB">Jobs</option>
                <option value="ESTIMATE">Estimates</option>
                <option value="INVOICE">Invoices</option>
              </select>
            ) : null}
            <select aria-label="Stage" value={filters.stage} onChange={(e) => set({ stage: e.target.value })} className={selectClass}>
              <option value="all">All stages</option>
              {options.stages
                .filter((s) => filters.type === 'all' || s.value.startsWith(`${filters.type}:`))
                .map((s) => (
                  <option key={s.value} value={s.value}>
                    {tab === 'all' ? `${s.value.split(':')[0][0]}${s.value.split(':')[0].slice(1).toLowerCase()} · ${s.label}` : s.label}
                  </option>
                ))}
            </select>
            <select aria-label="Client" value={filters.client} onChange={(e) => set({ client: e.target.value })} className={`${selectClass} max-w-[200px]`}>
              <option value="all">All clients</option>
              {options.clients.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <Input
              aria-label="Job site address"
              placeholder="Job site address"
              value={filters.address}
              onChange={(e) => set({ address: e.target.value })}
              className="h-9 w-44"
            />
            <select aria-label="Responsible" value={filters.employee} onChange={(e) => set({ employee: e.target.value })} className={`${selectClass} max-w-[180px]`}>
              <option value="all">Everyone</option>
              {options.employees.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <select aria-label="On hold" value={filters.hold} onChange={(e) => set({ hold: e.target.value as Filters['hold'] })} className={selectClass}>
              <option value="all">Any hold</option>
              <option value="held">On hold</option>
              <option value="not">Not on hold</option>
            </select>
            <select aria-label="Follow-up" value={filters.followUp} onChange={(e) => set({ followUp: e.target.value as Filters['followUp'] })} className={selectClass}>
              <option value="all">Any next action</option>
              <option value="overdue">Past due follow-up</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-500">
              From
              <Input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="h-9 w-36" />
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-500">
              To
              <Input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="h-9 w-36" />
            </label>
            {activeCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>
                Clear filters
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            <span>{visible.length} shown</span>
            {heldCount > 0 ? (
              <span className="flex items-center gap-1 text-orange-700">
                <PauseCircle className="h-3 w-3" /> {heldCount} on hold
              </span>
            ) : null}
            {followUpCount > 0 ? (
              <span className="flex items-center gap-1 text-red-600">
                <AlertTriangle className="h-3 w-3" /> {followUpCount} past-due follow-up{followUpCount === 1 ? '' : 's'}
              </span>
            ) : null}
            {!filters.from && !filters.to ? <span>Finished records from the last 90 days — pick dates to see older ones.</span> : null}
            {hiddenStageCount > 0 ? <span>{hiddenStageCount} in hidden columns</span> : null}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-gray-500">Loading…</div>
      ) : loadError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600">
            {loadError}
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : boardKey ? (
        columns.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-gray-500">All columns are hidden. Use Customize to show them again.</CardContent>
          </Card>
        ) : (
          <StatusBoard
            columns={columns}
            itemsByColumn={itemsByColumn}
            emptyLabel={tab === 'estimates' ? 'No estimates' : 'No invoices'}
            columnWidth={290}
            renderCard={(it: PipelineItem) => (
              <PipelineCard item={it} onOpen={() => onOpen(it.href)} onOpenRelated={onOpen} onManage={() => setManaging(it)} />
            )}
          />
        )
      ) : (
        <AllWorkList items={visible} onOpen={onOpen} onManage={setManaging} />
      )}

      <PipelineDetailsDialog
        item={managing}
        open={!!managing}
        onOpenChange={(o) => !o && setManaging(null)}
        config={config}
        people={people}
        onSave={saveState}
        onOpenRelated={onOpen}
      />
      {boardKey ? (
        <CustomizeViewDialog
          open={customizeOpen}
          onOpenChange={setCustomizeOpen}
          title={tab === 'estimates' ? 'Estimates pipeline' : 'Invoices pipeline'}
          columns={stageDefs.map((s) => ({ id: s.id, label: s.label, color: s.color }))}
          pref={viewPrefs[boardKey] || { order: [], hidden: [] }}
          onSave={(pref) => onSavePref(boardKey, pref)}
        />
      ) : null}
      {canManage ? <PipelineSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} config={config} onSave={saveSettings} /> : null}
    </>
  )
}

/** Estimate → Job → Invoice links for one row (only what really exists). */
function RelatedLinks({ item, onOpen }: { item: PipelineItem; onOpen: (href: string) => void }) {
  const links: Array<{ key: string; label: string; href: string }> = []
  if (item.related.estimate) links.push({ key: `e-${item.related.estimate.id}`, label: item.related.estimate.estimateNumber, href: `/dashboard/estimates/${item.related.estimate.id}` })
  for (const e of item.related.estimates) links.push({ key: `e-${e.id}`, label: e.estimateNumber, href: `/dashboard/estimates/${e.id}` })
  if (item.related.job) links.push({ key: `j-${item.related.job.id}`, label: item.related.job.jobNumber, href: `/dashboard/jobs/${item.related.job.id}` })
  for (const i of item.related.invoices) links.push({ key: `i-${i.id}`, label: i.invoiceNumber, href: `/dashboard/invoices/${i.id}` })
  if (links.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {links.slice(0, 5).map((l) => (
        <RelatedChip key={l.key} label={l.label} onClick={() => onOpen(l.href)} />
      ))}
      {links.length > 5 ? <span className="text-[10px] text-gray-400">+{links.length - 5}</span> : null}
    </div>
  )
}

function AllWorkList({
  items,
  onOpen,
  onManage,
}: {
  items: PipelineItem[]
  onOpen: (href: string) => void
  onManage: (item: PipelineItem) => void
}) {
  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          Number(b.followUpOverdue) - Number(a.followUpOverdue) ||
          Number(b.hold.onHold) - Number(a.hold.onHold) ||
          (b.daysInStage ?? 0) - (a.daysInStage ?? 0)
      ),
    [items]
  )
  if (sorted.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-gray-500">Nothing matches these filters.</CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="hidden grid-cols-[110px_1.3fr_1.2fr_1fr_1fr_1.3fr_90px] gap-3 border-b px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 lg:grid">
          <span>Record</span>
          <span>Client / site</span>
          <span>Stage</span>
          <span>Responsible</span>
          <span>In stage</span>
          <span>Next action</span>
          <span />
        </div>
        <ul className="divide-y">
          {sorted.map((it) => (
            <li
              key={`${it.type}-${it.id}`}
              className="grid cursor-pointer grid-cols-1 gap-1 px-4 py-3 hover:bg-gray-50 lg:grid-cols-[110px_1.3fr_1.2fr_1fr_1fr_1.3fr_90px] lg:items-center lg:gap-3"
              onClick={() => onOpen(it.href)}
            >
              <div className="flex flex-wrap items-center gap-2 lg:block">
                <RecordTypeBadge type={it.type} />
                <div className="font-mono text-xs font-semibold text-blue-700 lg:mt-1">{it.number}</div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-900">{it.title}</div>
                <div className="truncate text-xs text-gray-500">
                  {[it.client?.name, it.jobSiteAddress].filter(Boolean).join(' · ') || '—'}
                </div>
                <RelatedLinks item={it} onOpen={onOpen} />
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: it.stageColor }}>
                  {it.stageLabel}
                </span>
                {it.type !== 'JOB' ? <span className="text-[11px] text-gray-500">{statusWord(it.status)}</span> : null}
                {it.type === 'INVOICE' && it.balance ? <span className="text-[11px] text-gray-500">· {formatCurrency(it.balance)} due</span> : null}
              </div>
              <div className="text-xs text-gray-700">{it.responsible?.name || 'Unassigned'}</div>
              <div className="text-xs text-gray-600">
                {daysLabel(it.daysInStage) || '—'}
                {it.enteredAt && it.type !== 'JOB' ? <div className="text-gray-400">since {shortDate(it.enteredAt)}</div> : null}
                {it.hold.onHold ? (
                  <div className="flex items-center gap-1 text-orange-700">
                    <PauseCircle className="h-3 w-3" />
                    {it.hold.reason || 'On hold'}
                  </div>
                ) : null}
              </div>
              <div className="text-xs text-gray-700">
                {it.nextAction || '—'}
                {it.followUpDate ? (
                  <div className={it.followUpOverdue ? 'font-semibold text-red-600' : 'text-gray-500'}>
                    {it.followUpOverdue ? 'Past due · ' : 'Follow up '}
                    {shortDate(it.followUpDate)}
                  </div>
                ) : it.type === 'JOB' && it.followUpOverdue && it.dueDate ? (
                  <div className="font-semibold text-red-600">Past due · {shortDate(it.dueDate)}</div>
                ) : null}
              </div>
              <div className="lg:text-right">
                {it.type !== 'JOB' ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onManage(it)
                    }}
                    className="rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-white"
                  >
                    Manage
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
