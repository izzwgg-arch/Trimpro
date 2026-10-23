'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Printer, Save, ShoppingCart, Trash2, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authFetch } from '@/lib/auth/client'
import { hasPermission, usePermissions } from '@/hooks/usePermissions'
import { formatDateTime } from '@/lib/utils'
import { activeValues, DOOR_FIELDS, type DoorFieldKey, type TakeoffConfig } from '@/lib/takeoffs/config'
import { CreatableCombobox } from './CreatableCombobox'

type Door = { key: string; location: string; notes: string } & Record<DoorFieldKey, string>
type Item = { key: string; category: string; quantity: string; unit: string; description: string; notes: string }

type Loaded = {
  id: string
  jobId: string
  title: string
  notes: string
  createdAt: string
  updatedAt: string
  createdBy: { name: string } | null
  updatedBy: { name: string } | null
  job: { id: string; jobNumber: string; title: string; customer: string; siteAddress: string } | null
}

let keySeq = 0
const newKey = () => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`
const emptyDoor = (): Door => ({
  key: newKey(),
  location: '',
  notes: '',
  height: '',
  width: '',
  swing: '',
  lock: '',
  jamb: '',
  hinge: '',
  doorStyle: '',
})
const doorHasData = (d: Door) => Boolean(d.location || d.notes || DOOR_FIELDS.some((f) => d[f.key]))
const itemHasData = (i: Item) => Boolean(i.quantity || i.unit || i.description || i.notes)

export function TakeoffEditor({ takeoffId }: { takeoffId: string }) {
  const router = useRouter()
  const { permissions } = usePermissions()
  const canEdit = hasPermission(permissions, 'jobs.takeoffs.edit')
  const canDelete = hasPermission(permissions, 'jobs.takeoffs.delete')
  const canMakePo = hasPermission(permissions, 'purchase_orders.create')

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [config, setConfig] = useState<TakeoffConfig | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [doors, setDoors] = useState<Door[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [dirty, setDirty] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  const applyTakeoff = useCallback((t: any) => {
    setLoaded(t)
    setTitle(t.title || '')
    setNotes(t.notes || '')
    setDoors((t.doors || []).map((d: any) => ({ ...emptyDoor(), ...d, key: d.id || newKey() })))
    setItems(
      (t.items || []).map((i: any) => ({
        key: i.id || newKey(),
        category: i.category,
        quantity: i.quantity === null || i.quantity === undefined ? '' : String(i.quantity),
        unit: i.unit || '',
        description: i.description || '',
        notes: i.notes || '',
      }))
    )
    setDirty(false)
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [tRes, cRes] = await Promise.all([authFetch(`/api/takeoffs/${takeoffId}`), authFetch('/api/takeoffs/settings')])
      const tData = await tRes.json().catch(() => ({}))
      const cData = await cRes.json().catch(() => ({}))
      if (!tRes.ok) {
        setLoadError(tData.error || 'Could not load this takeoff')
        return
      }
      if (cRes.ok) setConfig(cData.config)
      applyTakeoff(tData.takeoff)
    } catch {
      setLoadError('Could not load this takeoff')
    }
  }, [applyTakeoff, takeoffId])

  useEffect(() => {
    void load()
  }, [load])

  // Don't lose unsaved work by closing the tab or reloading.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const touch = () => {
    setDirty(true)
    setMessage(null)
  }

  const updateDoor = (key: string, field: keyof Door, value: string) => {
    setDoors((prev) => prev.map((d) => (d.key === key ? { ...d, [field]: value } : d)))
    touch()
  }
  const addDoors = (n: number) => {
    setDoors((prev) => [...prev, ...Array.from({ length: n }, emptyDoor)])
    touch()
  }
  const removeDoor = (door: Door, index: number) => {
    if (doorHasData(door) && !window.confirm(`Remove door #${index + 1}? Its details will be lost when you save.`)) return
    setDoors((prev) => prev.filter((d) => d.key !== door.key))
    touch()
  }

  const updateItem = (key: string, field: keyof Item, value: string) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)))
    touch()
  }
  const addItem = (category: string) => {
    setItems((prev) => [...prev, { key: newKey(), category, quantity: '', unit: '', description: '', notes: '' }])
    touch()
  }
  const removeItem = (item: Item) => {
    if (itemHasData(item) && !window.confirm('Remove this material? It will be lost when you save.')) return
    setItems((prev) => prev.filter((i) => i.key !== item.key))
    touch()
  }

  // Active categories, plus any category that already has saved rows (even if it was
  // turned off or removed in Settings later).
  const categories = useMemo(() => {
    const list = (config?.categories || []).filter((c) => c.active || items.some((i) => i.category === c.key))
    const known = new Set((config?.categories || []).map((c) => c.key))
    const orphans = Array.from(new Set(items.map((i) => i.category).filter((k) => !known.has(k))))
    return [...list, ...orphans.map((k) => ({ key: k, label: k, active: false, options: [] }))]
  }, [config, items])

  const fieldOptions = (key: DoorFieldKey) => activeValues(config?.doorFields?.[key])
  const unitOptions = activeValues(config?.units)

  const save = async (): Promise<boolean> => {
    if (!loaded) return false
    setSaving(true)
    setMessage(null)
    try {
      const res = await authFetch(`/api/takeoffs/${loaded.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedUpdatedAt: loaded.updatedAt,
          title,
          notes,
          doors: doors.map(({ key, ...d }) => d),
          items: items.map(({ key, ...i }) => i),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Could not save the takeoff' })
        return false
      }
      applyTakeoff(data.takeoff)
      setMessage({ type: 'success', text: 'Takeoff saved' })
      return true
    } catch {
      setMessage({ type: 'error', text: 'Could not save the takeoff. Check your connection and try again.' })
      return false
    } finally {
      setSaving(false)
    }
  }

  const leave = async (href: string) => {
    if (dirty) {
      const ok = window.confirm('You have unsaved changes. Save them first?')
      if (ok) {
        if (!(await save())) return
      } else if (!window.confirm('Leave without saving? Your changes will be lost.')) {
        return
      }
    }
    router.push(href)
  }

  const deleteTakeoff = async () => {
    if (!loaded) return
    if (!window.confirm('Delete this whole takeoff, with all doors and materials? This cannot be undone.')) return
    const res = await authFetch(`/api/takeoffs/${loaded.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setMessage({ type: 'error', text: data.error || 'Could not delete the takeoff' })
      return
    }
    setDirty(false)
    router.push(`/dashboard/jobs/${loaded.jobId}`)
  }

  if (loadError) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-red-600">{loadError}</p>
          <Button variant="outline" onClick={() => router.back()}>
            Back
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (!loaded) return <p className="p-6 text-gray-600">Loading takeoff…</p>

  const ro = !canEdit

  return (
    <div className="space-y-4 pb-28">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" className="text-sm text-blue-600 hover:underline" onClick={() => leave(`/dashboard/jobs/${loaded.jobId}`)}>
            ← Back to job {loaded.job?.jobNumber}
          </button>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">Material Takeoff</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/print/takeoffs/${loaded.id}`} target="_blank">
            <Button variant="outline" className="h-11">
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </Link>
          {canMakePo ? (
            <Button
              variant="outline"
              className="h-11"
              onClick={() => leave(`/dashboard/purchase-orders/new?jobId=${loaded.jobId}&fromTakeoff=${loaded.id}`)}
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              Convert to PO
            </Button>
          ) : null}
          {canDelete ? (
            <Button variant="outline" className="h-11 text-red-600 hover:text-red-700" onClick={deleteTakeoff}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Customer" value={loaded.job?.customer} />
          <Info label="Job Number" value={loaded.job ? `${loaded.job.jobNumber} — ${loaded.job.title}` : ''} />
          <Info label="Job Site Address" value={loaded.job?.siteAddress} />
          <Info label="Created" value={`${formatDateTime(loaded.createdAt)}${loaded.createdBy?.name ? ` by ${loaded.createdBy.name}` : ''}`} />
          <Info label="Last Updated" value={`${formatDateTime(loaded.updatedAt)}${loaded.updatedBy?.name ? ` by ${loaded.updatedBy.name}` : ''}`} />
          <div>
            <Label htmlFor="takeoff-title">Name (optional)</Label>
            <Input
              id="takeoff-title"
              value={title}
              disabled={ro}
              placeholder="e.g. First floor"
              onChange={(e) => {
                setTitle(e.target.value)
                touch()
              }}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor="takeoff-notes">Notes</Label>
            <textarea
              id="takeoff-notes"
              rows={3}
              value={notes}
              disabled={ro}
              onChange={(e) => {
                setNotes(e.target.value)
                touch()
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </CardContent>
      </Card>

      {/* Door schedule */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Door Schedule ({doors.length})</CardTitle>
          {!ro ? (
            <div className="flex gap-2">
              <Button variant="outline" className="h-11" onClick={() => addDoors(1)}>
                <Plus className="mr-1 h-4 w-4" />
                Add Door
              </Button>
              <Button variant="outline" className="h-11" onClick={() => addDoors(10)}>
                <Plus className="mr-1 h-4 w-4" />
                Add 10 Doors
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {doors.length === 0 ? <p className="text-sm text-gray-500">No doors yet.</p> : null}

          {/* Desktop: one row per door */}
          {doors.length > 0 ? (
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-gray-500">
                    <th className="w-10 py-2 pr-2">#</th>
                    <th className="min-w-[10rem] pr-2">Location / Notes</th>
                    {DOOR_FIELDS.map((f) => (
                      <th key={f.key} className="min-w-[7.5rem] pr-2">
                        {f.label}
                      </th>
                    ))}
                    <th className="min-w-[9rem] pr-2">Additional Notes</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {doors.map((d, i) => (
                    <tr key={d.key} className="border-b align-top">
                      <td className="py-2 pr-2 pt-4 font-semibold text-gray-700">{i + 1}</td>
                      <td className="py-2 pr-2">
                        <Input value={d.location} disabled={ro} aria-label={`Door ${i + 1} location`} onChange={(e) => updateDoor(d.key, 'location', e.target.value)} />
                      </td>
                      {DOOR_FIELDS.map((f) => (
                        <td key={f.key} className="py-2 pr-2">
                          {ro ? (
                            <Input value={d[f.key]} disabled />
                          ) : (
                            <CreatableCombobox
                              value={d[f.key]}
                              options={fieldOptions(f.key)}
                              ariaLabel={`Door ${i + 1} ${f.label}`}
                              onChange={(v) => updateDoor(d.key, f.key, v)}
                            />
                          )}
                        </td>
                      ))}
                      <td className="py-2 pr-2">
                        <Input value={d.notes} disabled={ro} aria-label={`Door ${i + 1} notes`} onChange={(e) => updateDoor(d.key, 'notes', e.target.value)} />
                      </td>
                      <td className="py-2">
                        {!ro ? (
                          <button
                            type="button"
                            aria-label={`Remove door ${i + 1}`}
                            className="flex h-10 w-10 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
                            onClick={() => removeDoor(d, i)}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Phones / tablets: one card per door */}
          <div className="space-y-3 xl:hidden">
            {doors.map((d, i) => (
              <div key={d.key} className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-base font-semibold">Door #{i + 1}</p>
                  {!ro ? (
                    <Button variant="outline" size="sm" className="h-10 text-red-600" onClick={() => removeDoor(d, i)}>
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove Door
                    </Button>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="col-span-2 sm:col-span-4">
                    <Label>Location / Notes</Label>
                    <Input value={d.location} disabled={ro} onChange={(e) => updateDoor(d.key, 'location', e.target.value)} />
                  </div>
                  {DOOR_FIELDS.map((f) => (
                    <div key={f.key}>
                      <Label>{f.label}</Label>
                      {ro ? (
                        <Input value={d[f.key]} disabled />
                      ) : (
                        <CreatableCombobox value={d[f.key]} options={fieldOptions(f.key)} onChange={(v) => updateDoor(d.key, f.key, v)} />
                      )}
                    </div>
                  ))}
                  <div className="col-span-2 sm:col-span-4">
                    <Label>Additional Notes</Label>
                    <Input value={d.notes} disabled={ro} onChange={(e) => updateDoor(d.key, 'notes', e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!ro && doors.length > 0 ? (
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="h-11" onClick={() => addDoors(1)}>
                <Plus className="mr-1 h-4 w-4" />
                Add Door
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Other materials */}
      <Card>
        <CardHeader>
          <CardTitle>Other Materials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {categories.map((c) => {
            const rows = items.filter((i) => i.category === c.key)
            const options = activeValues(c.options)
            return (
              <div key={c.key} className="border-b border-gray-100 pb-4 last:border-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-semibold text-gray-800">
                    {c.label}
                    {!c.active ? <span className="ml-2 text-xs font-normal text-gray-400">(no longer offered)</span> : null}
                  </p>
                  {!ro ? (
                    <Button variant="outline" size="sm" className="h-10" onClick={() => addItem(c.key)}>
                      <Plus className="mr-1 h-4 w-4" />
                      Add Material
                    </Button>
                  ) : null}
                </div>
                {rows.length === 0 ? <p className="text-sm text-gray-400">None</p> : null}
                <div className="space-y-2">
                  {rows.map((it) => (
                    <div key={it.key} className="grid grid-cols-2 gap-2 rounded-md bg-gray-50 p-2 sm:grid-cols-12 sm:items-end">
                      <div className="sm:col-span-2">
                        <Label>Quantity</Label>
                        <Input inputMode="decimal" value={it.quantity} disabled={ro} placeholder="0" onChange={(e) => updateItem(it.key, 'quantity', e.target.value)} />
                      </div>
                      <div className="sm:col-span-2">
                        <Label>Unit</Label>
                        {ro ? <Input value={it.unit} disabled /> : <CreatableCombobox value={it.unit} options={unitOptions} onChange={(v) => updateItem(it.key, 'unit', v)} />}
                      </div>
                      <div className="col-span-2 sm:col-span-4">
                        <Label>Description / Spec</Label>
                        {ro ? (
                          <Input value={it.description} disabled />
                        ) : (
                          <CreatableCombobox value={it.description} options={options} onChange={(v) => updateItem(it.key, 'description', v)} />
                        )}
                      </div>
                      <div className="col-span-2 sm:col-span-3">
                        <Label>Notes</Label>
                        <Input value={it.notes} disabled={ro} onChange={(e) => updateItem(it.key, 'notes', e.target.value)} />
                      </div>
                      <div className="col-span-2 flex justify-end sm:col-span-1">
                        {!ro ? (
                          <button
                            type="button"
                            aria-label="Remove material"
                            className="flex h-10 w-10 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
                            onClick={() => removeItem(it)}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Save bar */}
      {!ro ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <p className={`text-sm ${message?.type === 'error' ? 'text-red-600' : message ? 'text-green-700' : 'text-gray-500'}`}>
              {message?.text || (dirty ? 'You have unsaved changes' : 'All changes saved')}
            </p>
            <Button className="h-11 min-w-[8rem]" onClick={() => void save()} disabled={saving || !dirty}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : message ? (
        <p className="text-sm text-red-600">{message.text}</p>
      ) : null}
    </div>
  )
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm text-gray-900">{value || '—'}</p>
    </div>
  )
}
