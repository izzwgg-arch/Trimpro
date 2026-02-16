'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TableColumn<T> {
  key: string
  header: string
  render: (item: T) => ReactNode
  sortValue?: (item: T) => string | number
  className?: string
}

interface TableViewProps<T> {
  data: T[]
  columns: TableColumn<T>[]
  rowKey: (item: T) => string
  onRowClick?: (item: T) => void
}

export function TableView<T>({ data, columns, rowKey, onRowClick }: TableViewProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const sortedData = useMemo(() => {
    if (!sortKey) return data
    const column = columns.find((c) => c.key === sortKey)
    if (!column?.sortValue) return data

    return [...data].sort((a, b) => {
      const av = column.sortValue!(a)
      const bv = column.sortValue!(b)

      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDirection === 'asc' ? av - bv : bv - av
      }

      const as = String(av).toLowerCase()
      const bs = String(bv).toLowerCase()
      if (as < bs) return sortDirection === 'asc' ? -1 : 1
      if (as > bs) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
  }, [columns, data, sortDirection, sortKey])

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDirection('asc')
      return
    }
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted/60">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={cn('px-3 py-2 text-left font-medium', column.className)}>
                {column.sortValue ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort(column.key)}
                  >
                    <span>{column.header}</span>
                    {sortKey === column.key ? (
                      sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                    ) : null}
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((item) => (
            <tr
              key={rowKey(item)}
              className={cn('border-t hover:bg-muted/30', onRowClick ? 'cursor-pointer' : '')}
              onClick={() => onRowClick?.(item)}
            >
              {columns.map((column) => (
                <td key={column.key} className={cn('px-3 py-2 align-middle', column.className)}>
                  {column.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

