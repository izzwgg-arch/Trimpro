'use client'

import { Sidebar } from './sidebar'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if user is authenticated
    const accessToken = localStorage.getItem('accessToken')
    const user = localStorage.getItem('user')

    if (!accessToken || !user) {
      router.push('/auth/login')
      return
    }

    setLoading(false)
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
    <div className="flex h-full min-h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-gray-100 min-h-0">
        <div className="p-6 bg-gray-100">{children}</div>
      </main>
    </div>
  )
}
