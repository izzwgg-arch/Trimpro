'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChevronUp, ChevronDown, Eye, EyeOff } from 'lucide-react'
import type { BoardViewPref } from '@/lib/production/view-preferences'

interface ColumnOption {
  id: string
  label: string
  color?: string
}

/**
 * Per-user "Customize view" for a production-line board: reorder columns and
 * hide/show them. Saves only this user's personal view — never the tenant config.
 */
export function CustomizeViewDialog({
  open,
  onOpenChange,
  title,
  columns,
  pref,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  columns: ColumnOption[] // full set (already in the user's current order)
  pref: BoardViewPref
  onSave: (pref: BoardViewPref) => Promise<void> | void
}) {
  const [order, setOrder] = useState<string[]>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    // Current order = the order columns are already shown in, then any missing.
    const known = columns.map((c) => c.id)
    const ordered = [...(pref.order || []).filter((id) => known.includes(id))]
    for (const id of known) if (!ordered.includes(id)) ordered.push(id)
    setOrder(ordered)
    setHidden(new Set(pref.hidden || []))
  }, [open, columns, pref])

  const byId = new Map(columns.map((c) => [c.id, c]))
  const move = (idx: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }
  const toggleHidden = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ order, hidden: Array.from(hidden) })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customize {title}</DialogTitle>
          <DialogDescription>Reorder or hide columns. This changes only your own view.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {order.map((id, idx) => {
            const col = byId.get(id)
            if (!col) return null
            const isHidden = hidden.has(id)
            return (
              <div key={id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                {col.color ? <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: col.color }} /> : null}
                <span className={`flex-1 text-sm ${isHidden ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{col.label}</span>
                <button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30" onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30" onClick={() => move(idx, 1)} disabled={idx === order.length - 1} title="Move down">
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button type="button" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={() => toggleHidden(id)} title={isHidden ? 'Show column' : 'Hide column'}>
                  {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save my view'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
