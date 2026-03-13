'use client'
import { use } from 'react'
import { redirect } from 'next/navigation'

// Redirect /session/active to /session for clean URL
export default function ActiveSessionRedirect({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params)
  redirect(`/smart-steps/${clientId}/session`)
}
