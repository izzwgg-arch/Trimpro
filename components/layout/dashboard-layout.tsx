'use client'

import { Sidebar } from './sidebar'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Emergency fix: Remove any stuck dialog overlays
    const removeStuckOverlays = () => {
      // Remove all Radix Dialog overlays that might be stuck
      const overlays = document.querySelectorAll('[data-radix-dialog-overlay]')
      overlays.forEach((overlay) => {
        const state = overlay.getAttribute('data-state')
        if (state === 'closed' || !state) {
          overlay.remove()
        }
      })
      
      // Remove any fixed overlay divs with black backgrounds
      const fixedOverlays = document.querySelectorAll('div[class*="fixed"][class*="inset-0"][class*="bg-black"]')
      fixedOverlays.forEach((overlay) => {
        const computedStyle = window.getComputedStyle(overlay)
        if (computedStyle.position === 'fixed' && computedStyle.zIndex === '50') {
          const parent = overlay.closest('[data-radix-dialog-root]')
          if (!parent || parent.getAttribute('data-state') === 'closed') {
            overlay.remove()
          }
        }
      })
    }

    // Run immediately and on interval
    removeStuckOverlays()
    const interval = setInterval(removeStuckOverlays, 1000)

    // Check if user is authenticated
    const accessToken = localStorage.getItem('accessToken')
    const user = localStorage.getItem('user')

    if (!accessToken || !user) {
      router.push('/auth/login')
      return () => clearInterval(interval)
    }

    setLoading(false)

    return () => clearInterval(interval)
  }, [router])

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
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto min-h-full bg-gray-100">
        <div className="p-6 min-h-full">{children}</div>
      </main>
    </div>
  )
}
