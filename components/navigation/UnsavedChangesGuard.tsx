'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Warns before leaving a create/edit page with unsaved edits.
 *
 * Mounted once in the dashboard layout. It arms only on /new and /edit routes,
 * and only after the user actually changes something — so a page the user merely
 * opened and left untouched never prompts.
 *
 * Covered exit paths (all ask "Leave without saving?"):
 *  - Closing the tab / reloading / typing a new URL  → native beforeunload.
 *  - Clicking any in-app link (sidebar, search, breadcrumbs, logo).
 *  - The browser Back/Forward button and in-page Back/Cancel (history popstate).
 *
 * A successful Save navigates forward via router.push, which is neither an
 * anchor click nor a history pop, so it is NOT blocked.
 */
const MESSAGE = 'You have unsaved changes on this page.\n\nLeave without saving? Your changes will be lost.'

function isGuardedRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return /\/new(\/|$)/.test(pathname) || /\/edit(\/|$)/.test(pathname)
}

export function UnsavedChangesGuard() {
  const pathname = usePathname()

  // Synchronous source of truth for the native listeners below.
  const dirtyRef = useRef(false)
  const activeRef = useRef(false)
  // True while our extra "sentinel" history entry is in place to catch Back.
  const sentinelRef = useRef(false)

  // Every navigation lands on a fresh page: recompute arm-state, start clean.
  useEffect(() => {
    activeRef.current = isGuardedRoute(pathname)
    dirtyRef.current = false
    sentinelRef.current = false
  }, [pathname])

  // Mark the page dirty the first time the user changes a value, and drop a
  // sentinel history entry so the browser Back button becomes interceptable.
  useEffect(() => {
    const arm = () => {
      if (dirtyRef.current) return
      dirtyRef.current = true
      if (!sentinelRef.current) {
        try {
          window.history.pushState({ __unsavedGuard: true }, '', window.location.href)
          sentinelRef.current = true
        } catch {}
      }
    }

    const inContent = (el: HTMLElement | null): boolean =>
      !!el && !!el.closest('main') && !el.closest('[data-unsaved-ignore]')

    // Native form controls: typing, textarea, native <select>, contenteditable.
    const onEdit = (event: Event) => {
      if (!activeRef.current || dirtyRef.current) return
      const t = event.target as HTMLElement | null
      if (!t) return
      const tag = t.tagName
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
      if (editable && inContent(t)) arm()
    }

    // Custom controls (Radix/shadcn Select, switches, radios, dropdown menus)
    // don't emit input/change on a field — catch the option/toggle click.
    const SELECTION_SELECTOR =
      '[role="option"],[role="switch"],[role="radio"],[role="menuitemradio"],[role="menuitemcheckbox"]'
    const onSelect = (event: Event) => {
      if (!activeRef.current || dirtyRef.current) return
      const t = event.target as HTMLElement | null
      const control = t?.closest?.(SELECTION_SELECTOR) as HTMLElement | null
      if (control && inContent(control)) arm()
    }

    document.addEventListener('input', onEdit, true)
    document.addEventListener('change', onEdit, true)
    document.addEventListener('pointerdown', onSelect, true)
    return () => {
      document.removeEventListener('input', onEdit, true)
      document.removeEventListener('change', onEdit, true)
      document.removeEventListener('pointerdown', onSelect, true)
    }
  }, [])

  // Tab close / reload / external URL — native browser prompt.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // In-app link clicks (capture phase, before Next's own Link handler).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return

      let url: URL
      try {
        url = new URL(href, window.location.origin)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return

      const next = `${url.pathname}${url.search}`
      const current = `${window.location.pathname}${window.location.search}`
      if (next === current) return

      if (window.confirm(MESSAGE)) {
        dirtyRef.current = false // allow the navigation to proceed
      } else {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // Browser/in-page Back & Forward. The sentinel entry we pushed on arming is
  // what gets popped here, so the URL has not really changed yet when we ask.
  useEffect(() => {
    const onPopState = () => {
      if (!dirtyRef.current) {
        sentinelRef.current = false
        return
      }
      if (window.confirm(MESSAGE)) {
        // Leave: drop the guard and go back one more (past the edit page).
        dirtyRef.current = false
        sentinelRef.current = false
        window.history.back()
      } else {
        // Stay: re-arm the sentinel so the next Back is caught too.
        try {
          window.history.pushState({ __unsavedGuard: true }, '', window.location.href)
          sentinelRef.current = true
        } catch {}
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return null
}
