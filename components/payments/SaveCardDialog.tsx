'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CardTerminal, type CardTerminalHandle } from '@/components/payments/CardTerminal'

export function SaveCardDialog(props: {
  clientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { clientId, open, onOpenChange, onSaved } = props
  const terminalRef = useRef<CardTerminalHandle>(null)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setLabel('')
      setError(null)
    }
  }, [open])

  const handleSave = async () => {
    setError(null)
    let tokens: { cardToken: string; cvvToken: string; exp: string; zip: string }
    try {
      tokens = await terminalRef.current!.tokenize()
    } catch (e: any) {
      return setError(e?.message || 'Please check the card details.')
    }
    setSaving(true)
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/clients/${clientId}/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cardToken: tokens.cardToken, cvvToken: tokens.cvvToken, exp: tokens.exp, zip: tokens.zip || undefined, label: label.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      setSaving(false)
      if (!res.ok) return setError(data.error || 'Failed to save the card.')
      onSaved()
      onOpenChange(false)
    } catch (e: any) {
      setSaving(false)
      setError(e?.message || 'Failed to save the card.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save a card on file</DialogTitle>
          <DialogDescription>
            The card is entered directly into the secure payment fields — it never passes through TrimPro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <CardTerminal ref={terminalRef} disabled={saving} />
          <div>
            <Label htmlFor="cardLabel">Label (optional)</Label>
            <Input id="cardLabel" placeholder="e.g. Business Visa" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save card'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
