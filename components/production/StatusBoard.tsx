'use client'

import React from 'react'
import { StageIcon } from '@/components/production/StageIcon'
import { useDragScroll } from '@/components/production/useDragScroll'

interface BoardCol {
  id: string
  label: string
  color: string
  icon: string
}

/** Generic status board (colored columns + cards) used for the Tasks and Leads
 *  production-line tabs. Matches the jobs board's look. */
export function StatusBoard<T extends { id: string }>({
  columns,
  itemsByColumn,
  renderCard,
  emptyLabel = 'No items',
  columnWidth = 300,
}: {
  columns: BoardCol[]
  itemsByColumn: Record<string, T[]>
  renderCard: (item: T) => React.ReactNode
  emptyLabel?: string
  columnWidth?: number
}) {
  const dragScrollRef = useDragScroll()
  return (
    <div ref={dragScrollRef} className="scrollbar-visible-x flex cursor-grab gap-4 overflow-x-auto pb-3">
      {columns.map((col) => {
        const items = itemsByColumn[col.id] || []
        return (
          <div
            key={col.id}
            className="flex max-h-[65vh] flex-shrink-0 flex-col rounded-lg border bg-gray-50"
            style={{ width: columnWidth }}
          >
            <div
              className="flex items-center justify-between rounded-t-lg border-b px-3 py-2 text-white"
              style={{ backgroundColor: col.color }}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <StageIcon name={col.icon} className="h-4 w-4" />
                {col.label}
              </span>
              <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-semibold">{items.length}</span>
            </div>
            <div className="scrollbar-visible-x flex-1 space-y-2 overflow-y-auto p-2">
              {items.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-gray-400">{emptyLabel}</p>
              ) : (
                items.map((item) => <React.Fragment key={item.id}>{renderCard(item)}</React.Fragment>)
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
