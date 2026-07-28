'use client'

import { useEffect, useState } from 'react'
import { clearListHighlight, readListSession } from '@/lib/navigation/nav-stack'

/**
 * After returning to a list, restore scroll and expose the last-opened row id
 * for highlight styling.
 */
export function useListRestore(entity: string, options?: { highlightMs?: number }) {
  const highlightMs = options?.highlightMs ?? 3500
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const session = readListSession(entity)
    if (!session) return

    if (typeof session.scrollY === 'number' && session.scrollY > 0) {
      const y = session.scrollY
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: 'auto' })
      })
    }

    if (session.lastOpenedId) {
      setHighlightedId(session.lastOpenedId)
      const id = session.lastOpenedId
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-row-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
      const t = window.setTimeout(() => {
        setHighlightedId(null)
        clearListHighlight(entity)
      }, highlightMs)
      return () => window.clearTimeout(t)
    }
  }, [entity, highlightMs])

  return { highlightedId }
}
