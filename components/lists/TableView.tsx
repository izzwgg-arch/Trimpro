'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, SlidersHorizontal, Eye, EyeOff, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ResponsiveTableContainer } from '@/components/layout/ResponsiveTableContainer'
import { ColumnResizeHandle, useResizableColumns } from '@/hooks/useResizableColumns'

export interface TableColumn<T> {
  key: string
  header: string
  render: (item: T) => ReactNode
  sortValue?: (item: T) => string | number
  className?: string
  headerClassName?: string
  /** Initial / default pixel width when resizing is enabled */
  defaultWidth?: number
  /** Disable resize for this column */
  resizable?: boolean
  /** Pinned column that can't be hidden or reordered (e.g. select / actions). */
  locked?: boolean
  /** Hidden by default; the user can reveal it from the Columns menu. */
  defaultHidden?: boolean
}

interface TableViewProps<T> {
  data: T[]
  columns: TableColumn<T>[]
  rowKey: (item: T) => string
  onRowClick?: (item: T) => void
  sortKey?: string | null
  sortDirection?: 'asc' | 'desc'
  onSortChange?: (sortKey: string, sortDirection: 'asc' | 'desc') => void
  highlightedRowId?: string | null
  /** When set and sort is uncontrolled, persist sort in localStorage. */
  persistSortEntity?: string
  /** Persist column widths under this key (defaults to persistSortEntity). */
  persistWidthsEntity?: string
  /** Enable drag-to-resize column headers (default true). */
  resizableColumns?: boolean
  /** Per-user column show/hide + reorder, persisted under this key.
   *  Defaults to persistWidthsEntity / persistSortEntity. Set to null to disable. */
  tableKey?: string | null
}

function readStoredSort(entity?: string): { sortKey: string | null; sortDirection: 'asc' | 'desc' } {
  if (!entity || typeof window === 'undefined') return { sortKey: null, sortDirection: 'asc' }
  try {
    const raw = localStorage.getItem(`trimpro.list.prefs.${entity}`)
    if (!raw) return { sortKey: null, sortDirection: 'asc' }
    const p = JSON.parse(raw)
    return {
      sortKey: typeof p.sortKey === 'string' ? p.sortKey : null,
      sortDirection: p.sortDirection === 'desc' ? 'desc' : 'asc',
    }
  } catch {
    return { sortKey: null, sortDirection: 'asc' }
  }
}

function writeStoredSort(entity: string | undefined, sortKey: string | null, sortDirection: 'asc' | 'desc') {
  if (!entity || typeof window === 'undefined') return
  try {
    localStorage.setItem(`trimpro.list.prefs.${entity}`, JSON.stringify({ sortKey, sortDirection }))
  } catch {
    /* ignore */
  }
}

interface ColumnPrefs {
  order: string[]
  /** Columns the user explicitly hid. */
  hidden: string[]
  /** Columns the user explicitly revealed (overriding defaultHidden). */
  shown: string[]
}

function readStoredColumns(entity?: string | null): ColumnPrefs {
  if (!entity || typeof window === 'undefined') return { order: [], hidden: [], shown: [] }
  try {
    const raw = localStorage.getItem(`trimpro.table.columns.${entity}`)
    if (!raw) return { order: [], hidden: [], shown: [] }
    const p = JSON.parse(raw)
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string') : [])
    return { order: arr(p.order), hidden: arr(p.hidden), shown: arr(p.shown) }
  } catch {
    return { order: [], hidden: [], shown: [] }
  }
}

function writeStoredColumns(entity: string | null | undefined, prefs: ColumnPrefs) {
  if (!entity || typeof window === 'undefined') return
  try {
    localStorage.setItem(`trimpro.table.columns.${entity}`, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}

const isLockedCol = <T,>(c: TableColumn<T>) => c.locked || c.key === 'select' || c.key === 'actions'

export function TableView<T>({
  data,
  columns,
  rowKey,
  onRowClick,
  sortKey: controlledSortKey,
  sortDirection: controlledSortDirection,
  onSortChange,
  highlightedRowId,
  persistSortEntity,
  persistWidthsEntity,
  resizableColumns = true,
  tableKey,
}: TableViewProps<T>) {
  const stored = readStoredSort(persistSortEntity)
  const [localSortKey, setLocalSortKey] = useState<string | null>(stored.sortKey)
  const [localSortDirection, setLocalSortDirection] = useState<'asc' | 'desc'>(stored.sortDirection)
  const sortKey = controlledSortKey ?? localSortKey
  const sortDirection = controlledSortDirection ?? localSortDirection

  // ---- per-user column show/hide + reorder ----
  const columnsEntity = tableKey === null ? null : (tableKey ?? persistWidthsEntity ?? persistSortEntity ?? null)
  const customizable = Boolean(columnsEntity)
  const [colPrefs, setColPrefs] = useState<ColumnPrefs>({ order: [], hidden: [], shown: [] })
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setColPrefs(readStoredColumns(columnsEntity))
  }, [columnsEntity])

  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  const savePrefs = (next: ColumnPrefs) => {
    setColPrefs(next)
    writeStoredColumns(columnsEntity, next)
  }

  const { leadingLocked, trailingLocked, customColumns } = useMemo(() => {
    const lead: TableColumn<T>[] = []
    const trail: TableColumn<T>[] = []
    const custom: TableColumn<T>[] = []
    let seenCustom = false
    for (const c of columns) {
      if (isLockedCol(c)) {
        if (seenCustom) trail.push(c)
        else lead.push(c)
      } else {
        custom.push(c)
        seenCustom = true
      }
    }
    return { leadingLocked: lead, trailingLocked: trail, customColumns: custom }
  }, [columns])

  // Full ordered list of customizable keys (visible + hidden keep their slot).
  const orderedCustomKeys = useMemo(() => {
    const keys = customColumns.map((c) => c.key)
    const order = (colPrefs.order || []).filter((k) => keys.includes(k))
    for (const k of keys) if (!order.includes(k)) order.push(k)
    return order
  }, [customColumns, colPrefs.order])

  // Effective hidden = (defaultHidden columns the user hasn't revealed) + (columns the user hid).
  const hiddenSet = useMemo(() => {
    const shown = new Set(colPrefs.shown || [])
    const set = new Set<string>()
    for (const c of customColumns) if (c.defaultHidden && !shown.has(c.key)) set.add(c.key)
    for (const k of colPrefs.hidden || []) set.add(k)
    return set
  }, [customColumns, colPrefs.hidden, colPrefs.shown])

  const displayColumns = useMemo(() => {
    if (!customizable) return columns
    const byKey = new Map(customColumns.map((c) => [c.key, c]))
    const visibleCustom = orderedCustomKeys
      .map((k) => byKey.get(k))
      .filter((c): c is TableColumn<T> => Boolean(c) && !hiddenSet.has((c as TableColumn<T>).key))
    return [...leadingLocked, ...visibleCustom, ...trailingLocked]
  }, [customizable, columns, customColumns, orderedCustomKeys, hiddenSet, leadingLocked, trailingLocked])

  const toggleHidden = (key: string) => {
    const hidden = new Set(colPrefs.hidden || [])
    const shown = new Set(colPrefs.shown || [])
    if (hiddenSet.has(key)) {
      // reveal: clear explicit-hide and mark explicitly shown (overrides defaultHidden)
      hidden.delete(key)
      shown.add(key)
    } else {
      // hide
      hidden.add(key)
      shown.delete(key)
    }
    savePrefs({ ...colPrefs, hidden: Array.from(hidden), shown: Array.from(shown) })
  }

  const moveColumn = (from: string, to: string) => {
    if (from === to) return
    const order = [...orderedCustomKeys]
    const fromIdx = order.indexOf(from)
    const toIdx = order.indexOf(to)
    if (fromIdx < 0 || toIdx < 0) return
    order.splice(toIdx, 0, order.splice(fromIdx, 1)[0])
    savePrefs({ ...colPrefs, order })
  }

  const resetColumns = () => savePrefs({ order: [], hidden: [], shown: [] })

  const widthDefaults = useMemo(() => {
    const map: Record<string, number> = {}
    for (const col of columns) {
      if (col.defaultWidth) map[col.key] = col.defaultWidth
    }
    return map
  }, [columns])

  const widthsEntity = persistWidthsEntity || persistSortEntity
  const { widths, onResizeStart } = useResizableColumns(
    resizableColumns ? widthsEntity : undefined,
    widthDefaults
  )

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
    const nextDirection = sortKey === key && sortDirection === 'asc' ? 'desc' : 'asc'
    if (onSortChange) {
      onSortChange(key, nextDirection)
      return
    }
    if (sortKey !== key) {
      setLocalSortKey(key)
      setLocalSortDirection('asc')
      writeStoredSort(persistSortEntity, key, 'asc')
      return
    }
    setLocalSortDirection((prev) => {
      const next = prev === 'asc' ? 'desc' : 'asc'
      writeStoredSort(persistSortEntity, key, next)
      return next
    })
  }

  const hiddenCount = customizable ? customColumns.filter((c) => hiddenSet.has(c.key)).length : 0

  return (
    <div className="space-y-2">
      {customizable && (
        <div className="flex items-center justify-end">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Columns{hiddenCount > 0 ? ` (${customColumns.length - hiddenCount}/${customColumns.length})` : ''}
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-60 rounded-md border bg-popover p-1 shadow-lg">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">Show columns</span>
                  <button type="button" onClick={resetColumns} className="text-[11px] text-blue-600 hover:underline">
                    Reset
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {orderedCustomKeys.map((key) => {
                    const col = customColumns.find((c) => c.key === key)
                    if (!col) return null
                    const isHidden = hiddenSet.has(key)
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleHidden(key)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                      >
                        {isHidden ? (
                          <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 shrink-0 text-blue-600" />
                        )}
                        <span className={cn('truncate', isHidden ? 'text-muted-foreground line-through' : '')}>
                          {col.header || key}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">
                  Drag a column header to reorder. Saved for you on this device.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <ResponsiveTableContainer className="rounded-md border bg-card">
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <thead className="sticky top-0 z-10 bg-muted/60">
            <tr>
              {displayColumns.map((column) => {
                const canResize = resizableColumns && column.resizable !== false
                const width = widths[column.key] ?? column.defaultWidth
                const draggable = customizable && !isLockedCol(column)
                return (
                  <th
                    key={column.key}
                    className={cn(
                      'relative px-3 py-2 text-left font-medium',
                      column.headerClassName,
                      column.className,
                      draggable && dragKey === column.key ? 'opacity-50' : ''
                    )}
                    style={width ? { width, minWidth: width } : undefined}
                    onDragOver={draggable ? (e) => { e.preventDefault() } : undefined}
                    onDrop={draggable ? (e) => { e.preventDefault(); if (dragKey) moveColumn(dragKey, column.key); setDragKey(null) } : undefined}
                  >
                    <div
                      className={cn('flex items-center gap-1', draggable ? 'cursor-grab active:cursor-grabbing' : '')}
                      draggable={draggable}
                      onDragStart={draggable ? (e) => { setDragKey(column.key); e.dataTransfer.effectAllowed = 'move' } : undefined}
                      onDragEnd={draggable ? () => setDragKey(null) : undefined}
                    >
                      {draggable ? <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/50" /> : null}
                      {column.sortValue ? (
                        <button
                          type="button"
                          className="inline-flex min-h-[44px] max-w-full items-center gap-1 rounded-md px-1 active:text-foreground"
                          onClick={() => toggleSort(column.key)}
                        >
                          <span className="truncate">{column.header}</span>
                          {sortKey === column.key ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="h-3 w-3 shrink-0" />
                            ) : (
                              <ArrowDown className="h-3 w-3 shrink-0" />
                            )
                          ) : null}
                        </button>
                      ) : (
                        <span className="truncate">{column.header}</span>
                      )}
                    </div>
                    {canResize ? (
                      <ColumnResizeHandle onResizeStart={(x) => onResizeStart(column.key, x)} />
                    ) : null}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((item) => {
              const id = rowKey(item)
              const highlighted = Boolean(highlightedRowId && highlightedRowId === id)
              return (
                <tr
                  key={id}
                  data-row-id={id}
                  className={cn(
                    'border-t active:bg-muted/40 sm:hover:bg-muted/30 transition-colors',
                    onRowClick ? 'cursor-pointer touch-active-row' : '',
                    highlighted ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : ''
                  )}
                  onClick={() => onRowClick?.(item)}
                >
                  {displayColumns.map((column) => {
                    const width = widths[column.key] ?? column.defaultWidth
                    return (
                      <td
                        key={column.key}
                        className={cn('px-3 py-2 align-middle', column.className)}
                        style={width ? { width, minWidth: 48, maxWidth: width } : undefined}
                      >
                        {column.render(item)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </ResponsiveTableContainer>
    </div>
  )
}
