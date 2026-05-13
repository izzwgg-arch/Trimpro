'use client'

import { Sidebar } from './sidebar'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import { QboSyncFailureNotifier } from '@/components/qbo/QboSyncFailureNotifier'
import { GlobalSearch } from '@/components/search/GlobalSearch'
import { tryMoveFocusToNextFormField } from '@/lib/ui/enter-as-tab'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    const accessToken = localStorage.getItem('accessToken')
    const userRaw = localStorage.getItem('user')

    if (!accessToken || !userRaw) {
      router.push('/auth/login')
      return
    }

    try {
      const parsed = JSON.parse(userRaw)
      setIsAdmin(parsed?.role === 'ADMIN')
    } catch {}

    setLoading(false)
  }, [router])

  // Shift+Enter advances to next field like Tab (plain Enter unchanged for pickers, etc.; opt out: data-no-enter-tab on <form>).
  useEffect(() => {
    if (loading) return
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (pathname?.startsWith('/auth')) return
      if (e.key === 'Enter' && e.shiftKey) {
        const t = e.target as HTMLElement | null
        // eslint-disable-next-line no-console
        console.log('[SE] 1. dashboard-layout CAPTURE listener', {
          tag: t?.tagName,
          'data-col': t?.getAttribute?.('data-col'),
          'data-picker-input': t?.getAttribute?.('data-picker-input'),
          'inside-line-item-row': !!t?.closest?.('[data-line-item-row="true"]'),
          defaultPrevented: e.defaultPrevented,
        })
      }
      tryMoveFocusToNextFormField(e)
    }
    document.addEventListener('keydown', onDocKeyDown, true)
    return () => document.removeEventListener('keydown', onDocKeyDown, true)
  }, [loading, pathname])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-screen bg-gray-100">
      {isAdmin && <QboSyncFailureNotifier />}

      <Sidebar
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top bar — always visible on all screen sizes */}
        <header className="h-14 flex items-center gap-3 px-4 bg-white border-b border-gray-200 shrink-0 z-40">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Global search bar */}
          <div className="flex-1 max-w-2xl">
            <GlobalSearch />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-gray-100">
        <div className="p-6 bg-gray-100 min-h-full flex flex-col">
          <div className="flex-1">{children}</div>
          <footer className="mt-10 border-t border-gray-200 pt-4 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-3">
            <div>© {new Date().getFullYear()} TrimPro</div>
            <div className="flex items-center gap-4">
              <Link href="/privacy" className="hover:underline">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:underline">
                Terms
              </Link>
              <a className="hover:underline" href="mailto:support@trimprony.com">
                support@trimprony.com
              </a>
            </div>
          </footer>
        </div>
        </main>
      </div>
    </div>
  )
}
