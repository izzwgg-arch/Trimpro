'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type TeamUser = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  role?: string | null
}

type Props = {
  entityType: 'task' | 'request'
  entityId: string
  entityLabel: string
  /** Recipients pre-selected when the dialog opens (e.g. the assignee + creator). */
  defaultRecipientIds?: string[]
  buttonClassName?: string
}

function userName(u: TeamUser) {
  return `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email
}

export function SendEntityMessageDialog({
  entityType,
  entityId,
  entityLabel,
  defaultRecipientIds = [],
  buttonClassName,
}: Props) {
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<TeamUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentMessage, setSentMessage] = useState<string | null>(null)

  const endpoint = useMemo(
    () => (entityType === 'task' ? `/api/tasks/${entityId}/message` : `/api/leads/${entityId}/message`),
    [entityType, entityId]
  )

  const authHeaders = useCallback((json = false) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }, [])

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true)
    setError(null)
    try {
      const res = await fetch('/api/messages/users', { headers: authHeaders(), credentials: 'include' })
      if (!res.ok) throw new Error('Could not load team members')
      const data = await res.json()
      setUsers(Array.isArray(data.users) ? data.users : [])
    } catch (e: any) {
      setError(e?.message || 'Could not load team members')
    } finally {
      setLoadingUsers(false)
    }
  }, [authHeaders])

  useEffect(() => {
    if (!open) return
    setSentMessage(null)
    setError(null)
    setText('')
    setSelected(new Set(defaultRecipientIds.filter(Boolean)))
    void loadUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const send = async () => {
    const recipientIds = Array.from(selected)
    if (recipientIds.length === 0) {
      setError('Select at least one recipient')
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ recipientIds, text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not send message')
      setSentMessage(
        `Message sent to ${data.sent || recipientIds.length} ${
          (data.sent || recipientIds.length) === 1 ? 'person' : 'people'
        }.`
      )
      setText('')
      setTimeout(() => setOpen(false), 900)
    } catch (e: any) {
      setError(e?.message || 'Could not send message')
    } finally {
      setSending(false)
    }
  }

  const noun = entityType === 'task' ? 'task' : 'request'

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={buttonClassName}
        onClick={() => setOpen(true)}
        title={`Message about this ${noun}`}
      >
        <MessageSquare className="mr-2 h-4 w-4" />
        Message
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send a message</DialogTitle>
            <DialogDescription>
              This message is about {noun}: <span className="font-medium text-gray-900">{entityLabel}</span>. Recipients
              see that reference at the top of the message.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Recipients</p>
              <div className="max-h-44 overflow-y-auto rounded border border-gray-200 divide-y">
                {loadingUsers ? (
                  <p className="p-3 text-sm text-gray-500">Loading team…</p>
                ) : users.length === 0 ? (
                  <p className="p-3 text-sm text-gray-500">No team members found.</p>
                ) : (
                  users.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.has(u.id)}
                        onChange={() => toggle(u.id)}
                      />
                      <span className="flex-1 min-w-0 truncate">{userName(u)}</span>
                      {u.role ? <span className="text-xs text-gray-400">{u.role}</span> : null}
                    </label>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Message</p>
              <Textarea
                rows={4}
                placeholder={`Write a message about this ${noun}…`}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {sentMessage ? <p className="text-sm text-green-600">{sentMessage}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void send()} disabled={sending || selected.size === 0}>
              {sending ? 'Sending…' : 'Send message'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
