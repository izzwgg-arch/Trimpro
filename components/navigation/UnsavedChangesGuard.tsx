'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * Warns before leaving a create/edit page with unsaved edits.
 *
 * Mounted once in the dashboard layout. It only arms itself on /new and /edit
 * routes, and only after the user has actually touched a form field — so a
 * page the user merely opened and left untouched never prompts.
 *
 * Three exit paths are covered:
 *  - Closing the tab, reloading, or typing a new URL  → native beforeunload prompt.
 *  - Clicking any in-app link (sidebar, search, breadcrumbs, back arrow, logo)
 *    → a styled "Leave without saving?" dialog; "Leave" then completes the hop.
 *  - A successful Save or an explicit Cancel navigate programmatically
 *    (router.push / router.back), which are deliberate, so they are NOT blocked.
 */
function isGuardedRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return /\/new(\/|$)/.test(pathname) || /\/edit(\/|$)/.test(pathname)
}

export function UnsavedChangesGuard() {
  const pathname = usePathname()
  const router = useRouter()
  const active = isGuardedRoute(pathname)

  // dirtyRef is the source of truth for the synchronous listeners; dirty state
  // only exists to re-render when needed. pendingHref drives the dialog.
  const dirtyRef = useRef(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  // A fresh page (after save, cancel, or any navigation) always starts clean.
  useEffect(() => {
    dirtyRef.current = false
    setPendingHref(null)
  }, [pathname])

  // Mark dirty when the user edits a form control inside the page content.
  // Scoped to <main> so the header search box and sidebar never count.
  useEffect(() => {
    if (!active) return
    const markDirty = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      const isField =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
      if (!isField) return
      if (!target.closest('main')) return
      if (target.closest('[data-unsaved-ignore]')) return
      dirtyRef.current = true
    }
    document.addEventListener('input', markDirty, true)
    document.addEventListener('change', markDirty, true)
    return () => {
      document.removeEventListener('input', markDirty, true)
      document.removeEventListener('change', markDirty, true)
    }
  }, [active])

  // Tab close / reload / external URL — native browser prompt (text is fixed by
  // the browser). Always registered; it no-ops unless there are unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Intercept in-app link navigation (capture phase, like DashboardNavCapture).
  useEffect(() => {
    if (!active) return
    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const hrefAttr = anchor.getAttribute('href')
      if (!hrefAttr || hrefAttr.startsWith('#') || hrefAttr.startsWith('mailto:') || hrefAttr.startsWith('tel:')) {
        return
      }

      let url: URL
      try {
        url = new URL(hrefAttr, window.location.origin)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return

      const next = `${url.pathname}${url.search}`
      const current = `${window.location.pathname}${window.location.search}`
      if (next === current) return

      // Hold the navigation and ask first.
      event.preventDefault()
      event.stopPropagation()
      setPendingHref(next)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [active])

  if (!pendingHref) return null

  const leave = () => {
    const href = pendingHref
    dirtyRef.current = false
    setPendingHref(null)
    router.push(href)
  }

  const stay = () => setPendingHref(null)

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
            onClick={stay}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Stay on page
          </button>
          <button
            type="button"
            onClick={leave}
            className="rounded-md border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Leave without saving
          </button>
        </div>
      </div>
    </div>
  )
}
