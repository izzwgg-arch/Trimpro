'use client'

import { useCallback, useEffect, useRef } from 'react'

const DRAG_THRESHOLD_PX = 5

/**
 * Lets a horizontally scrolling board be panned by holding the mouse button and
 * dragging left/right (touch and pen already scroll natively). A drag never counts
 * as a click, so cards under the pointer don't open when a drag ends on them.
 * Pass the returned ref callback to the scrolling element.
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const elRef = useRef<T | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const attach = useCallback((el: T | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    elRef.current = el
    if (!el) return

    let startX = 0
    let startScroll = 0
    let pointerId: number | null = null
    let dragging = false

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      // Leave form controls and the native scrollbar alone.
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [data-no-drag-scroll]')) return
      if (el.scrollWidth <= el.clientWidth) return
      const rect = el.getBoundingClientRect()
      if (e.clientY > rect.top + el.clientHeight) return // on the horizontal scrollbar
      pointerId = e.pointerId
      startX = e.clientX
      startScroll = el.scrollLeft
      dragging = false
    }

    const onPointerMove = (e: PointerEvent) => {
      if (pointerId === null || e.pointerId !== pointerId) return
      const dx = e.clientX - startX
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
        dragging = true
        el.setPointerCapture(pointerId)
        el.style.cursor = 'grabbing'
        el.style.userSelect = 'none'
      }
      el.scrollLeft = startScroll - dx
      e.preventDefault()
    }

    const endDrag = (e: PointerEvent) => {
      if (pointerId === null || e.pointerId !== pointerId) return
      if (dragging) {
        try { el.releasePointerCapture(pointerId) } catch {}
        el.style.cursor = ''
        el.style.userSelect = ''
        // Swallow the click that follows the drag.
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation()
          ev.preventDefault()
        }
        window.addEventListener('click', swallow, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      }
      pointerId = null
      dragging = false
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    cleanupRef.current = () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
    }
  }, [])

  useEffect(() => () => cleanupRef.current?.(), [])

  return attach
}
