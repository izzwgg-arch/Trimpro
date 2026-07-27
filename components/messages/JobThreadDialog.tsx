'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { refreshAccessToken } from '@/lib/auth/client'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  jobNumber?: string | null
}

/**
 * Ensures the job conversation exists, then opens the full Messages UI
 * (same reply / reactions / attachments / voice features as Team & DM).
 */
export function JobThreadDialog({ open, onOpenChange, jobId, jobNumber }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAuth = useCallback(async (url: string, init?: RequestInit) => {
    let res = await fetch(url, { ...init, credentials: 'include' })
    if (res.status === 401) {
      const ok = await refreshAccessToken()
      if (ok) res = await fetch(url, { ...init, credentials: 'include' })
    }
    return res
  }, [])

  const openFullChat = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetchAuth('/api/messages/job/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Failed to open job chat')
        return
      }
      const conversationId = data.conversationId as string | undefined
      if (!conversationId) {
        setError('Job chat is unavailable')
        return
      }
      onOpenChange(false)
      router.push(`/dashboard/messages?conversationId=${encodeURIComponent(conversationId)}`)
    } catch {
      setError('Failed to open job chat')
    } finally {
      setLoading(false)
    }
  }, [fetchAuth, jobId, onOpenChange, router])

  useEffect(() => {
    if (!open || !jobId) return
    void openFullChat()
  }, [open, jobId, openFullChat])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{jobNumber ? `Job Chat · ${jobNumber}` : 'Job Chat'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {loading && !error ? (
            <p className="text-sm text-muted-foreground">Opening full chat…</p>
          ) : null}
          {error ? (
            <>
              <p className="text-sm text-destructive">{error}</p>
              <Button type="button" onClick={() => void openFullChat()} disabled={loading}>
                Try again
              </Button>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
