'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { unsavedChanges } from '@/lib/navigation/unsaved'

/**
 * Warns before leaving a create/edit page with unsaved edits.
 *
 * Mounted once in the dashboard layout. It arms only on /new and /edit routes,
 * and only after the user actually changes something — so a page the user merely
 * opened and left untouched never prompts.
 *
 * Covered exit paths:
 *  - In-app links (sidebar, search, breadcrumbs, logo)       → centered dialog.
 *  - Browser Back/Forward button                             → centered dialog.
 *  - In-app Back button / Cancel (smartBack, router.back)    → centered dialog.
 *  - Closing the tab / reloading / typing a new URL          → native prompt
 *    (the one case a custom dialog cannot intercept in time).
 *
 * A successful Save navigates forward via router.push, which is neither an
 * anchor click nor a history pop, so it is never blocked.
 */
function isGuardedRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return /\/new(\/|$)/.test(pathname) || /\/edit(\/|$)/.test(pathname)
}

export function UnsavedChangesGuard() {
  const pathname = usePathname()
  const router = useRouter()

  const activeRef = useRef(false)
  // True while our extra "sentinel" history entry is in place to catch Back.
  const sentinelRef = useRef(false)

  const promptOpen = useSyncExternalStore(
    unsavedChanges.subscribe,
    () => unsavedChanges.isPromptOpen(),
    () => false
  )

  // Every navigation lands on a fresh page: recompute arm-state, start clean.
  useEffect(() => {
    activeRef.current = isGuardedRoute(pathname)
    unsavedChanges.setDirty(false)
    sentinelRef.current = false
  }, [pathname])

  // Mark the page dirty the first time the user changes a value, and drop a
  // sentinel history entry so the browser Back button becomes interceptable.
  useEffect(() => {
    const arm = () => {
      if (unsavedChanges.isDirty()) return
      unsavedChanges.setDirty(true)
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
      if (!activeRef.current || unsavedChanges.isDirty()) return
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
      if (!activeRef.current || unsavedChanges.isDirty()) return
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

  // Tab close / reload / external URL — native browser prompt (unavoidable).
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!unsavedChanges.isDirty()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // In-app link clicks (capture phase, before Next's own Link handler).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!unsavedChanges.isDirty()) return
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

      // Hold the navigation and ask with our dialog.
      event.preventDefault()
      event.stopPropagation()
      void unsavedChanges.confirmLeave().then((leave) => {
        if (leave) {
          unsavedChanges.setDirty(false)
          router.push(next)
        }
      })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [router])

  // Browser/in-page Back & Forward. The sentinel we pushed on arming is what
  // gets popped here, so the page is still shown (same URL) while we ask.
  useEffect(() => {
    const onPopState = () => {
      if (!unsavedChanges.isDirty()) {
        sentinelRef.current = false
        return
      }
      sentinelRef.current = false
      void unsavedChanges.confirmLeave().then((leave) => {
        if (leave) {
          unsavedChanges.setDirty(false)
          window.history.back()
        } else {
          // Stay: re-arm the sentinel so the next Back is caught too.
          try {
            window.history.pushState({ __unsavedGuard: true }, '', window.location.href)
            sentinelRef.current = true
          } catch {}
        }
      })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (!promptOpen) return null

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-title"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl text-center">
        <h2 id="unsaved-title" className="text-xl font-bold text-gray-900">
          Leave without saving?
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          You have unsaved changes on this page. If you leave now they will be lost.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => unsavedChanges.resolvePrompt(false)}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Stay on page
          </button>
          <button
            type="button"
            onClick={() => unsavedChanges.resolvePrompt(true)}
            className="rounded-md border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Leave without saving
          </button>
        </div>
      </div>
    </div>
  )
}
