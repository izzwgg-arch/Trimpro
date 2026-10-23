'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

/**
 * Pick one of the options or type your own value. Whatever is in the box is the
 * value — typed text is kept exactly (fractions, quotes, hyphens).
 *
 * The list is drawn on top of the page (portal, fixed position) so it is never cut
 * off by a scrolling table such as the door schedule.
 */
export function CreatableCombobox({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  className = '',
}: {
  value: string
  onChange: (next: string) => void
  options: string[]
  placeholder?: string
  ariaLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const place = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const showAbove = below < 180 && above > below
    setPos({
      left: rect.left,
      top: showAbove ? rect.top - 4 : rect.bottom + 4,
      width: Math.max(rect.width, 160),
      maxHeight: Math.max(120, Math.min(260, showAbove ? above : below)),
      above: showAbove,
    })
  }, [])

  const openList = useCallback(() => {
    setFilter('')
    setHighlight(0)
    place()
    setOpen(true)
  }, [place])

  useLayoutEffect(() => {
    if (!open) return
    place()
    const onMove = () => place()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options
  }, [filter, options])

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
    setFilter('')
  }

  const list =
    open && pos && (shown.length > 0 || filter.trim()) ? (
      <ul
        ref={listRef}
        style={{
          position: 'fixed',
          left: pos.left,
          top: pos.above ? undefined : pos.top,
          bottom: pos.above ? window.innerHeight - pos.top : undefined,
          width: pos.width,
          maxHeight: pos.maxHeight,
        }}
        className="z-[200] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
      >
        {shown.map((o, i) => (
          <li key={o}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              className={`block w-full px-3 py-2.5 text-left hover:bg-blue-50 ${i === highlight ? 'bg-blue-50' : ''} ${
                o === value ? 'font-semibold' : ''
              }`}
            >
              {o}
            </button>
          </li>
        ))}
        {filter.trim() && !options.includes(filter.trim()) ? (
          <li className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">Custom value “{filter.trim()}” will be saved</li>
        ) : null}
      </ul>
    ) : null

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="flex items-center rounded-md border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-blue-500">
        <input
          ref={inputRef}
          aria-label={ariaLabel}
          value={value}
          placeholder={placeholder ?? (options.length ? 'Select or type' : 'Type')}
          onFocus={openList}
          onClick={() => {
            if (!open) openList()
          }}
          onChange={(e) => {
            onChange(e.target.value)
            setFilter(e.target.value)
            setHighlight(0)
            if (!open) place()
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (!open) openList()
              setHighlight((h) => Math.min(h + 1, Math.max(shown.length - 1, 0)))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
            } else if (e.key === 'Enter' && open && shown[highlight] !== undefined) {
              e.preventDefault()
              choose(shown[highlight])
            } else if (e.key === 'Escape' || e.key === 'Tab') {
              setOpen(false)
            }
          }}
          className="h-10 w-full min-w-0 rounded-md bg-transparent px-2 text-sm outline-none"
        />
        {options.length > 0 ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Show options"
            className="flex h-10 w-8 shrink-0 items-center justify-center text-gray-500 hover:text-gray-800"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (open) setOpen(false)
              else openList()
              inputRef.current?.focus()
            }}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {list && typeof document !== 'undefined' ? createPortal(list, document.body) : null}
    </div>
  )
}
