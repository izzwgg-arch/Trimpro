'use client'

import { useEffect, useState } from 'react'
import { GripVertical, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ReorderTask = {
  id: string
  title: string
  status?: string
  priority?: string
  dueDate?: string | null
}

/**
 * Drag-to-reorder the task list. Reordering updates the manual order (sortOrder)
 * on the server; the list must be fetched with ?sort=manual so it starts from the
 * saved order. Persists when a drag ends.
 */
export function TaskReorderList<T extends ReorderTask>({
  tasks,
  onPersist,
  onDone,
  loading,
}: {
  tasks: T[]
  onPersist: (ordered: T[]) => void
  onDone: () => void
  loading?: boolean
}) {
  const [items, setItems] = useState<T[]>(tasks)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    setItems(tasks)
  }, [tasks])

  const move = (from: number, to: number) => {
    setItems((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev
      const next = prev.slice()
      const [m] = next.splice(from, 1)
      next.splice(to, 0, m)
      return next
    })
  }

  const handleDrop = () => {
    setDragIndex(null)
    onPersist(items)
    setSavedAt(Date.now())
  }

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-sm text-gray-600">
          Drag the rows to set the order. {loading ? 'Loading…' : null}
          {savedAt ? (
            <span className="ml-2 inline-flex items-center text-green-600">
              <Check className="mr-1 h-3.5 w-3.5" /> Saved
            </span>
          ) : null}
        </div>
        <Button size="sm" variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
      <ul className="divide-y">
        {items.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-gray-500">No tasks to reorder.</li>
        ) : (
          items.map((task, index) => (
            <li
              key={task.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragIndex !== null && dragIndex !== index) {
                  move(dragIndex, index)
                  setDragIndex(index)
                }
              }}
              onDragEnd={handleDrop}
              onDrop={handleDrop}
              className={`flex items-center gap-3 px-4 py-3 ${
                dragIndex === index ? 'bg-blue-50' : 'bg-white'
              } cursor-grab active:cursor-grabbing`}
            >
              <GripVertical className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="w-6 shrink-0 text-xs font-semibold text-gray-400">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{task.title}</span>
              {task.priority ? (
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">
                  {task.priority}
                </span>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
