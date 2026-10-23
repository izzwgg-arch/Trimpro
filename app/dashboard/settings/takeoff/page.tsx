'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronDown, ChevronUp, Plus, Save, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authFetch } from '@/lib/auth/client'
import { hasPermission, usePermissions } from '@/hooks/usePermissions'
import { DOOR_FIELDS, slugCategoryKey, type TakeoffConfig, type TakeoffOption } from '@/lib/takeoffs/config'

/**
 * Settings → Material Takeoff: the dropdown options offered on takeoffs and which
 * material categories are available. Turning an option off or removing it never
 * changes takeoffs that already use it.
 */
export default function TakeoffSettingsPage() {
  const router = useRouter()
  const { permissions, loading: permsLoading } = usePermissions()
  const canManage = hasPermission(permissions, 'jobs.takeoffs.settings')
  const [config, setConfig] = useState<TakeoffConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [newCategory, setNewCategory] = useState('')

  useEffect(() => {
    ;(async () => {
      const res = await authFetch('/api/takeoffs/settings')
      const data = await res.json().catch(() => ({}))
      if (res.ok) setConfig(data.config)
      else setMessage({ type: 'error', text: data.error || 'Could not load takeoff settings' })
    })()
  }, [])

  const change = (next: TakeoffConfig) => {
    setConfig(next)
    setDirty(true)
    setMessage(null)
  }

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      const res = await authFetch('/api/takeoffs/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Could not save' })
        return
      }
      setConfig(data.config)
      setDirty(false)
      setMessage({ type: 'success', text: 'Takeoff settings saved' })
    } finally {
      setSaving(false)
    }
  }

  if (!config) {
    return <p className="p-6 text-gray-600">{message?.text || 'Loading…'}</p>
  }

  const ro = permsLoading || !canManage

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/settings')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Settings
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Material Takeoff</h1>
          <p className="text-sm text-gray-600">
            Dropdown options and material categories for takeoffs. Anyone filling in a takeoff can still type their own value.
          </p>
        </div>
      </div>
      {!permsLoading && !canManage ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          You can view these options, but you need the “Manage Takeoff Dropdowns” permission to change them.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Door Schedule Dropdowns</CardTitle>
          <CardDescription>Turned-off options are hidden from new picks but stay on takeoffs that already use them.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {DOOR_FIELDS.map((f) => (
            <OptionList
              key={f.key}
              title={f.label}
              options={config.doorFields[f.key]}
              readOnly={ro}
              onChange={(opts) => change({ ...config, doorFields: { ...config.doorFields, [f.key]: opts } })}
            />
          ))}
          <OptionList title="Units (materials)" options={config.units} readOnly={ro} onChange={(opts) => change({ ...config, units: opts })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Material Categories</CardTitle>
          <CardDescription>Turn a category off to hide it on new takeoffs. Each category can have its own suggested descriptions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {config.categories.map((c, idx) => (
            <div key={c.key} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  value={c.label}
                  disabled={ro}
                  onChange={(e) => {
                    const categories = [...config.categories]
                    categories[idx] = { ...c, label: e.target.value }
                    change({ ...config, categories })
                  }}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={c.active}
                    disabled={ro}
                    onChange={(e) => {
                      const categories = [...config.categories]
                      categories[idx] = { ...c, active: e.target.checked }
                      change({ ...config, categories })
                    }}
                  />
                  Available
                </label>
                {!ro ? (
                  <span className="ml-auto flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={idx === 0}
                      aria-label="Move up"
                      onClick={() => {
                        const categories = [...config.categories]
                        ;[categories[idx - 1], categories[idx]] = [categories[idx], categories[idx - 1]]
                        change({ ...config, categories })
                      }}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={idx === config.categories.length - 1}
                      aria-label="Move down"
                      onClick={() => {
                        const categories = [...config.categories]
                        ;[categories[idx + 1], categories[idx]] = [categories[idx], categories[idx + 1]]
                        change({ ...config, categories })
                      }}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </span>
                ) : null}
              </div>
              <div className="mt-3">
                <OptionList
                  title="Suggested descriptions"
                  options={c.options}
                  readOnly={ro}
                  onChange={(opts) => {
                    const categories = [...config.categories]
                    categories[idx] = { ...c, options: opts }
                    change({ ...config, categories })
                  }}
                />
              </div>
            </div>
          ))}
          {!ro ? (
            <div className="flex gap-2">
              <Input placeholder="New category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="max-w-xs" />
              <Button
                variant="outline"
                disabled={!newCategory.trim()}
                onClick={() => {
                  const label = newCategory.trim()
                  let key = slugCategoryKey(label)
                  while (config.categories.some((c) => c.key === key)) key = `${key}_2`
                  change({ ...config, categories: [...config.categories, { key, label, active: true, options: [] }] })
                  setNewCategory('')
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add Category
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!ro ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <p className={`text-sm ${message?.type === 'error' ? 'text-red-600' : message ? 'text-green-700' : 'text-gray-500'}`}>
              {message?.text || (dirty ? 'You have unsaved changes' : 'No changes')}
            </p>
            <Button className="h-11" onClick={save} disabled={saving || !dirty}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function OptionList({
  title,
  options,
  readOnly,
  onChange,
}: {
  title: string
  options: TakeoffOption[]
  readOnly: boolean
  onChange: (next: TakeoffOption[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v || options.some((o) => o.value === v)) return
    onChange([...options, { value: v, active: true }])
    setDraft('')
  }
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-gray-800">{title}</p>
      {options.length === 0 ? <p className="mb-2 text-xs text-gray-400">No options yet — people type their own.</p> : null}
      <div className="space-y-1">
        {options.map((o, i) => (
          <div key={`${i}`} className="flex items-center gap-2">
            <Input
              value={o.value}
              disabled={readOnly}
              className={o.active ? '' : 'text-gray-400 line-through'}
              onChange={(e) => {
                const next = [...options]
                next[i] = { ...o, value: e.target.value }
                onChange(next)
              }}
            />
            <label className="flex shrink-0 items-center gap-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={o.active}
                disabled={readOnly}
                onChange={(e) => {
                  const next = [...options]
                  next[i] = { ...o, active: e.target.checked }
                  onChange(next)
                }}
              />
              On
            </label>
            {!readOnly ? (
              <button
                type="button"
                aria-label={`Remove ${o.value}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => onChange(options.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {!readOnly ? (
        <div className="mt-2 flex gap-2">
          <Input
            placeholder="Add option"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <Button variant="outline" onClick={add} disabled={!draft.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
