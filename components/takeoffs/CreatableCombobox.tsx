'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Pick one of the options or type your own value. Whatever is in the box is the
 * value — typed text is kept exactly (fractions, quotes, hyphens).
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
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
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

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="flex items-center rounded-md border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-blue-500">
        <input
          ref={inputRef}
          aria-label={ariaLabel}
          value={value}
          placeholder={placeholder}
          onFocus={() => {
            setFilter('')
            setHighlight(0)
            setOpen(true)
          }}
          onChange={(e) => {
            onChange(e.target.value)
            setFilter(e.target.value)
            setHighlight(0)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setHighlight((h) => Math.min(h + 1, Math.max(shown.length - 1, 0)))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
            } else if (e.key === 'Enter' && open && shown[highlight] !== undefined && filter) {
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
            className="flex h-10 w-8 shrink-0 items-center justify-center text-gray-400 hover:text-gray-700"
            onClick={() => {
              setFilter('')
              setOpen((o) => !o)
              inputRef.current?.focus()
            }}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {open && (shown.length > 0 || filter.trim()) ? (
        <ul className="absolute z-30 mt-1 max-h-60 w-full min-w-[10rem] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg">
          {shown.map((o, i) => (
            <li key={o}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                className={`block w-full px-3 py-2 text-left ${i === highlight ? 'bg-blue-50' : ''} ${
                  o === value ? 'font-semibold' : ''
                }`}
              >
                {o}
              </button>
            </li>
          ))}
          {filter.trim() && !options.includes(filter.trim()) ? (
            <li className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
              Custom value “{filter.trim()}” will be saved
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
