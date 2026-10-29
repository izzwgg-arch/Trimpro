'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckSquare, GripVertical, Plus, Square, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authFetch } from '@/lib/auth/client'

type Item = { id: string; title: string; isCompleted: boolean }

/** Checklist on a task: tick items off, add, rename and remove them. */
export function TaskChecklist({ taskId, initialItems }: { taskId: string; initialItems?: Item[] }) {
  const [items, setItems] = useState<Item[]>(initialItems || [])
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch(`/api/tasks/${taskId}/checklist`)
    if (res.ok) setItems((await res.json()).items || [])
  }, [taskId])

  useEffect(() => {
    void load()
  }, [load])

  const call = async (url: string, init: RequestInit) => {
    setError(null)
    const res = await authFetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Could not update the checklist')
      return null
    }
    return data
  }

  const add = async () => {
    const title = draft.trim()
    if (!title || busy) return
    setBusy(true)
    const data = await call(`/api/tasks/${taskId}/checklist`, { method: 'POST', body: JSON.stringify({ title }) })
    setBusy(false)
    if (data?.item) {
      setItems((prev) => [...prev, data.item])
      setDraft('')
    }
  }

  const toggle = async (item: Item) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isCompleted: !i.isCompleted } : i)))
    const data = await call(`/api/tasks/${taskId}/checklist/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isCompleted: !item.isCompleted }),
    })
    if (!data) setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))
  }

  const rename = async () => {
    if (!editing) return
    const title = editing.text.trim()
    const current = items.find((i) => i.id === editing.id)
    setEditing(null)
    if (!current || !title || title === current.title) return
    const data = await call(`/api/tasks/${taskId}/checklist/${current.id}`, { method: 'PATCH', body: JSON.stringify({ title }) })
    if (data?.item) setItems((prev) => prev.map((i) => (i.id === current.id ? data.item : i)))
  }

  const remove = async (item: Item) => {
    if (!window.confirm(`Remove “${item.title}” from the checklist?`)) return
    const data = await call(`/api/tasks/${taskId}/checklist/${item.id}`, { method: 'DELETE' })
    if (data) setItems((prev) => prev.filter((i) => i.id !== item.id))
  }

  const moveItem = (from: number, to: number) => {
    setItems((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev
      const next = prev.slice()
      const [m] = next.splice(from, 1)
      next.splice(to, 0, m)
      return next
    })
  }

  const persistOrder = async () => {
    setDragIndex(null)
    const ids = items.map((i) => i.id)
    const data = await call(`/api/tasks/${taskId}/checklist/reorder`, { method: 'POST', body: JSON.stringify({ ids }) })
    if (data?.items) setItems(data.items)
  }

  const done = items.filter((i) => i.isCompleted).length

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Checklist</CardTitle>
        {items.length > 0 ? (
          <span className="text-sm text-gray-500">
            {done}/{items.length} done
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length > 0 ? (
          <div className="h-1.5 overflow-hidden rounded bg-gray-100">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        ) : null}
        {items.map((item, index) => (
          <div
            key={item.id}
            draggable={editing?.id !== item.id}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragIndex !== null && dragIndex !== index) {
                moveItem(dragIndex, index)
                setDragIndex(index)
              }
            }}
            onDragEnd={() => void persistOrder()}
            onDrop={() => void persistOrder()}
            className={`group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-gray-50 ${dragIndex === index ? 'bg-blue-50' : ''}`}
          >
            <span className="flex h-9 w-5 shrink-0 cursor-grab items-center justify-center text-gray-300 active:cursor-grabbing" aria-hidden>
              <GripVertical className="h-4 w-4" />
            </span>
            <button
              type="button"
              aria-label={item.isCompleted ? `Mark “${item.title}” not done` : `Mark “${item.title}” done`}
              className="flex h-9 w-9 shrink-0 items-center justify-center"
              onClick={() => void toggle(item)}
            >
              {item.isCompleted ? <CheckSquare className="h-5 w-5 text-green-600" /> : <Square className="h-5 w-5 text-gray-400" />}
            </button>
            {editing?.id === item.id ? (
              <Input
                autoFocus
                value={editing.text}
                onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                onBlur={() => void rename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void rename()
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <button
                type="button"
                className={`flex-1 text-left text-sm ${item.isCompleted ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                onClick={() => setEditing({ id: item.id, text: item.title })}
                title="Click to edit"
              >
                {item.title}
              </button>
            )}
            <button
              type="button"
              aria-label={`Remove “${item.title}”`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-600"
              onClick={() => void remove(item)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <Input
            placeholder="Add a checklist item"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void add()
              }
            }}
          />
          <Button type="button" onClick={() => void add()} disabled={!draft.trim() || busy}>
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
