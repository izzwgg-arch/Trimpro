'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { Check, CreditCard, Banknote, Zap, MoreHorizontal, ArrowLeft } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { InvoiceAllocator, type Allocation } from '@/components/payments/InvoiceAllocator'
import { CardTerminal, type CardTerminalHandle } from '@/components/payments/CardTerminal'

type View = 'hub' | 'card'

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

const FREQS = [
  { v: 'WEEKLY', l: 'Weekly' },
  { v: 'BIWEEKLY', l: 'Every 2 weeks' },
  { v: 'MONTHLY', l: 'Monthly' },
  { v: 'QUARTERLY', l: 'Quarterly' },
  { v: 'YEARLY', l: 'Yearly' },
]

export function ReceivePaymentHub(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  clientId: string
  balance?: number
  onDone?: () => void
}) {
  const { open, onOpenChange, invoiceId, clientId, balance, onDone } = props
  const router = useRouter()
  const [view, setView] = useState<View>('hub')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const terminalRef = useRef<CardTerminalHandle>(null)
  const idemRef = useRef<string>('')

  // Card flow
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [allocTotal, setAllocTotal] = useState(0)
  const [chargeNow, setChargeNow] = useState(true)
  const [memo, setMemo] = useState('')
  const [makeRecurring, setMakeRecurring] = useState(false)
  const [amount, setAmount] = useState('')
  const [frequency, setFrequency] = useState('MONTHLY')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [endMode, setEndMode] = useState<'none' | 'date' | 'count'>('none')
  const [endDate, setEndDate] = useState('')
  const [maxOccurrences, setMaxOccurrences] = useState('')

  useEffect(() => {
    if (open) {
      setView('hub')
      setError(null)
      setInfo(null)
      setChargeNow(true)
      setMemo('')
      setMakeRecurring(false)
      setEndMode('none')
      setAmount(balance && balance > 0 ? String(balance) : '')
      idemRef.current = globalThis.crypto?.randomUUID?.() || String(Date.now() + Math.random())
    }
  }, [open, balance])

  const post = async (url: string, body: any) => {
    const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  }
  const finish = () => {
    onOpenChange(false)
    onDone?.()
  }

  // Non-card methods share ONE screen: the full payment page (method preset).
  const goPaymentPage = (method: string) => {
    onOpenChange(false)
    router.push(`/dashboard/payments/new?invoiceId=${invoiceId}&method=${method}`)
  }

  const goAch = async () => {
    setError(null)
    setBusy(true)
    const { ok, data } = await post('/api/payments/qbo/ach/create-session', { invoiceId })
    setBusy(false)
    if (!ok) return setError(data.error || 'Failed to start ACH.')
    const url = data.hostedUrl || data.publicUrl
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    setInfo('ACH payment link opened in a new tab.')
    onDone?.()
  }

  const submitCard = async () => {
    setError(null)
    setInfo(null)
    if (!chargeNow && !makeRecurring) return setError('Choose to charge now, set up recurring, or both.')

    let tokens: { cardToken: string; cvvToken: string; exp: string; zip: string }
    try {
      tokens = await terminalRef.current!.tokenize()
    } catch (e: any) {
      return setError(e?.message || 'Please check the card details.')
    }

    // Recurring needs a reusable (vaulted) token; vault the entered card first.
    let cardOnFileId: string | null = null
    if (makeRecurring) {
      if (!(Number(amount) > 0)) return setError('Enter a recurring amount greater than zero.')
      setBusy(true)
      const v = await post(`/api/clients/${clientId}/cards`, { cardToken: tokens.cardToken, cvvToken: tokens.cvvToken, exp: tokens.exp, zip: tokens.zip || undefined })
      if (!v.ok) {
        setBusy(false)
        return setError(v.data.error || 'Could not save the card for the recurring schedule.')
      }
      cardOnFileId = v.data.card?.id || null
    }

    // Charge now
    if (chargeNow) {
      if (allocations.length === 0) {
        setBusy(false)
        return setError('Select at least one invoice to apply the charge to.')
      }
      setBusy(true)
      const body: any = { clientId, allocations, memo: memo || undefined, idempotencyKey: idemRef.current }
      if (cardOnFileId) body.cardOnFileId = cardOnFileId
      else { body.cardToken = tokens.cardToken; body.cvvToken = tokens.cvvToken; body.exp = tokens.exp; body.zip = tokens.zip || undefined }
      const { ok, data } = await post('/api/payments/charge-card', body)
      if (!ok) {
        setBusy(false)
        return setError(data.error || 'The card charge failed.')
      }
      if (makeRecurring && cardOnFileId) {
        const r = await post('/api/recurring-payments', {
          type: 'CARD', clientId, invoiceId, cardOnFileId, amount: Number(amount), frequency, startDate,
          endDate: endMode === 'date' ? endDate : null, maxOccurrences: endMode === 'count' ? Number(maxOccurrences) : null,
        })
        setBusy(false)
        if (!r.ok) {
          setInfo(`Payment charged (ref ${data.refNum || 'ok'}). The recurring schedule could NOT be created: ${r.data.error || 'error'}. The card was not charged again.`)
          onDone?.()
          return
        }
        onDone?.()
        return finish()
      }
      setBusy(false)
      return finish()
    }

    // Recurring only (card already vaulted above)
    setBusy(true)
    const r = await post('/api/recurring-payments', {
      type: 'CARD', clientId, invoiceId, cardOnFileId, amount: Number(amount), frequency, startDate,
      endDate: endMode === 'date' ? endDate : null, maxOccurrences: endMode === 'count' ? Number(maxOccurrences) : null,
    })
    setBusy(false)
    if (!r.ok) return setError(r.data.error || 'Failed to create the recurring charge.')
    return finish()
  }

  const Hub = (
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        { key: 'check', icon: Check, title: 'Check', desc: 'Record a check, apply it to invoices, optionally schedule recurring checks.', btn: 'Apply Check', onClick: () => goPaymentPage('CHECK') },
        { key: 'card', icon: CreditCard, title: 'Credit Card', desc: 'Charge a card, apply to invoices, optionally set up recurring card payments.', btn: 'Pay with Credit Card', onClick: () => setView('card') },
        { key: 'ach', icon: Banknote, title: 'ACH', desc: 'Start a bank (ACH) payment using your existing ACH flow.', btn: 'Go to ACH', onClick: goAch },
        { key: 'quickpay', icon: Zap, title: 'Quick Pay', desc: 'Open the existing Quick Pay flow for a fast customer payment.', btn: 'Open Quick Pay', onClick: () => goPaymentPage('QUICK_PAY') },
        { key: 'other', icon: MoreHorizontal, title: 'Other', desc: 'Record cash, wire, money order, or another payment method.', btn: 'Record Other Payment', onClick: () => goPaymentPage('OTHER') },
      ].map((c) => {
        const Icon = c.icon
        const secondary = c.key === 'ach' || c.key === 'quickpay'
        return (
          <div key={c.key} className="flex flex-col rounded-lg border p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
              <h3 className="font-semibold text-gray-900">{c.title}</h3>
            </div>
            <p className="mb-3 flex-1 text-xs text-gray-500">{c.desc}</p>
            <Button type="button" size="sm" variant={secondary ? 'outline' : 'default'} onClick={c.onClick} disabled={busy}>{c.btn}</Button>
          </div>
        )
      })}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view !== 'hub' && (
              <button type="button" onClick={() => setView('hub')} className="text-gray-400 hover:text-gray-700"><ArrowLeft className="h-4 w-4" /></button>
            )}
            {view === 'hub' ? 'Receive Payment' : 'Credit card payment'}
          </DialogTitle>
          <DialogDescription>
            {view === 'hub' ? 'Choose a payment method.' : 'Enter the card and apply it across the customer’s open invoices.'}
          </DialogDescription>
        </DialogHeader>

        {view === 'hub' && Hub}

        {view === 'card' && (
          <div className="space-y-3">
            <CardTerminal ref={terminalRef} disabled={busy} />

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chargeNow} onChange={(e) => setChargeNow(e.target.checked)} />
              Charge the card now
            </label>
            {chargeNow && <InvoiceAllocator invoiceId={invoiceId} onChange={(a, t) => { setAllocations(a); setAllocTotal(t) }} />}
            {chargeNow && <div className="text-right text-sm font-semibold">Total to charge: {formatCurrency(allocTotal)}</div>}
            <div><Label>Memo (optional)</Label><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={makeRecurring} onChange={(e) => setMakeRecurring(e.target.checked)} />
              Set up recurring credit card payments
            </label>
            {makeRecurring && (
              <div className="space-y-3 rounded-md border bg-gray-50 p-3">
                <div><Label>Recurring amount</Label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Frequency</Label>
                    <select className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                      {FREQS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                    </select>
                  </div>
                  <div><Label>Start / next date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
                  <div>
                    <Label>Ends</Label>
                    <select className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={endMode} onChange={(e) => setEndMode(e.target.value as any)}>
                      <option value="none">Until cancelled</option>
                      <option value="date">On a date</option>
                      <option value="count">After N payments</option>
                    </select>
                  </div>
                  {endMode === 'date' && <div><Label>End date</Label><Input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>}
                  {endMode === 'count' && <div><Label># of payments</Label><Input inputMode="numeric" value={maxOccurrences} onChange={(e) => setMaxOccurrences(e.target.value)} /></div>}
                </div>
                <p className="text-xs text-gray-500">The card is saved on file and the recurring schedule is a separate record from any charge made now.</p>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {info && <p className="text-sm text-green-700">{info}</p>}

        {view === 'card' && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => setView('hub')} disabled={busy}>Back</Button>
            <Button onClick={submitCard} disabled={busy}>
              {busy ? 'Working…' : chargeNow ? `Charge ${formatCurrency(allocTotal)}` : 'Create recurring charge'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
