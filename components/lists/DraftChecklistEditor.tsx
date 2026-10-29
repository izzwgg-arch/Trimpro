'use client'

import { useState } from 'react'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/**
 * Edits a checklist before the parent record is saved: add, remove and drag to
 * reorder items. The value is a plain string[] (one title per item) so the parent
 * can send it as `subtasks` / `checklist`. Order is the array order.
 */
export function DraftChecklistEditor({
  value,
  onChange,
  label = 'Checklist',
  placeholder = 'Add a checklist item',
}: {
  value: string[]
  onChange: (next: string[]) => void
  label?: string
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const add = () => {
    const t = draft.trim()
    if (!t) return
    onChange([...value, t])
    setDraft('')
  }

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const editAt = (index: number, text: string) => {
    onChange(value.map((v, i) => (i === index ? text : v)))
  }

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return
    const next = value.slice()
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {label ? <p className="text-sm font-medium text-gray-700">{label}</p> : null}
      {value.map((item, index) => (
        <div
          key={index}
          draggable
          onDragStart={() => setDragIndex(index)}
          onDragOver={(e) => {
            e.preventDefault()
            if (dragIndex !== null && dragIndex !== index) {
              move(dragIndex, index)
              setDragIndex(index)
            }
          }}
          onDragEnd={() => setDragIndex(null)}
          onDrop={() => setDragIndex(null)}
          className={`flex items-center gap-2 rounded-md border px-2 py-1 ${dragIndex === index ? 'bg-blue-50' : 'bg-white'}`}
        >
          <span className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-gray-300 active:cursor-grabbing" aria-hidden>
            <GripVertical className="h-4 w-4" />
          </span>
          <Input
            value={item}
            onChange={(e) => editAt(index, e.target.value)}
            className="h-8 flex-1 border-0 shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            aria-label="Remove item"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-600"
            onClick={() => removeAt(index)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </div>
    </div>
  )
}
