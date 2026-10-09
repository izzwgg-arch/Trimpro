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

// Cardknox iFields: the card number + CVV are entered in Cardknox-hosted iframes,
// so the raw card never touches our page or our server. getTokens() turns them
// into one-time tokens we send to the server to vault (cc:save).
const IFIELDS_SCRIPT = 'https://cdn.cardknox.com/ifields/3.5.2607.1401/ifields.min.js'
const IFIELD_FRAME = 'https://cdn.cardknox.com/ifields/3.5.2607.1401/ifield.htm'

let scriptPromise: Promise<void> | null = null
function loadIfieldsScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if ((window as any).getTokens) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = IFIELDS_SCRIPT
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load the secure card form.'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

export function SaveCardDialog(props: {
  clientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { clientId, open, onOpenChange, onSaved } = props
  const ifieldsKey = process.env.NEXT_PUBLIC_CARDKNOX_IFIELDS_KEY
  const [ready, setReady] = useState(false)
  const [exp, setExp] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (!open) {
      initialized.current = false
      setReady(false)
      setError(null)
      setExp('')
      setLabel('')
      return
    }
    if (!ifieldsKey) {
      setError('Card capture is not configured yet (missing iFields key).')
      return
    }
    let cancelled = false
    loadIfieldsScript()
      .then(() => {
        if (cancelled) return
        try {
          ;(window as any).setAccount?.(ifieldsKey, 'TrimPro', '1.0')
          ;(window as any).enableAutoFormatting?.()
          initialized.current = true
          setReady(true)
        } catch (e: any) {
          setError(e?.message || 'Could not initialize the secure card form.')
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Could not load the secure card form.')
      })
    return () => {
      cancelled = true
    }
  }, [open, ifieldsKey])

  const handleSave = () => {
    setError(null)
    const digits = exp.replace(/\D/g, '')
    if (digits.length !== 4) {
      setError('Enter the card expiration as MMYY (e.g. 0530).')
      return
    }
    if (!(window as any).getTokens) {
      setError('The secure card form is not ready yet.')
      return
    }
    setSaving(true)
    ;(window as any).getTokens(
      async () => {
        try {
          const cardToken = (document.querySelector('[data-ifields-id="card-number-token"]') as HTMLInputElement)?.value
          const cvvToken = (document.querySelector('[data-ifields-id="cvv-token"]') as HTMLInputElement)?.value
          if (!cardToken) {
            setSaving(false)
            setError('Could not read the card. Please re-enter the card number.')
            return
          }
          const token = localStorage.getItem('accessToken')
          const res = await fetch(`/api/clients/${clientId}/cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ cardToken, cvvToken, exp: digits, label: label.trim() || undefined }),
          })
          const data = await res.json().catch(() => ({}))
          setSaving(false)
          if (!res.ok) {
            setError(data.error || 'Failed to save the card.')
            return
          }
          onSaved()
          onOpenChange(false)
        } catch (e: any) {
          setSaving(false)
          setError(e?.message || 'Failed to save the card.')
        }
      },
      (err: any) => {
        setSaving(false)
        setError(typeof err === 'string' ? err : 'Please check the card details and try again.')
      },
      60000
    )
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

        {!ifieldsKey ? (
          <p className="text-sm text-red-600">
            Card capture isn’t configured yet. Add the Cardknox iFields key to enable this.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Card number</Label>
              <iframe
                title="Card number"
                data-ifields-id="card-number"
                data-ifields-placeholder="Card number"
                src={IFIELD_FRAME}
                className="h-10 w-full rounded-md border border-gray-300"
                style={{ display: 'block' }}
              />
              <input data-ifields-id="card-number-token" name="xCardNum" type="hidden" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cardExp">Expiration (MMYY)</Label>
                <Input
                  id="cardExp"
                  inputMode="numeric"
                  placeholder="0530"
                  maxLength={5}
                  value={exp}
                  onChange={(e) => setExp(e.target.value)}
                />
              </div>
              <div>
                <Label>CVV</Label>
                <iframe
                  title="CVV"
                  data-ifields-id="cvv"
                  data-ifields-placeholder="CVV"
                  src={IFIELD_FRAME}
                  className="h-10 w-full rounded-md border border-gray-300"
                  style={{ display: 'block' }}
                />
                <input data-ifields-id="cvv-token" name="xCVV" type="hidden" />
              </div>
            </div>
            <div>
              <Label htmlFor="cardLabel">Label (optional)</Label>
              <Input
                id="cardLabel"
                placeholder="e.g. Business Visa"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            {!ready && <p className="text-xs text-gray-500">Loading the secure card form…</p>}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !ready || !ifieldsKey}>
            {saving ? 'Saving…' : 'Save card'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
