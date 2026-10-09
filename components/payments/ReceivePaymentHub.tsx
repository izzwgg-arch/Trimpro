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
import { SaveCardDialog } from '@/components/payments/SaveCardDialog'

type View = 'hub' | 'check' | 'card' | 'other'

interface CardRow {
  id: string
  maskedCard: string | null
  cardType: string | null
  isDefault: boolean
}

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

function RecurringFields(props: {
  frequency: string
  setFrequency: (v: string) => void
  startDate: string
  setStartDate: (v: string) => void
  endMode: 'none' | 'date' | 'count'
  setEndMode: (v: 'none' | 'date' | 'count') => void
  endDate: string
  setEndDate: (v: string) => void
  maxOccurrences: string
  setMaxOccurrences: (v: string) => void
}) {
  const p = props
  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border bg-gray-50 p-3">
      <div>
        <Label>Frequency</Label>
        <select className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={p.frequency} onChange={(e) => p.setFrequency(e.target.value)}>
          {FREQS.map((f) => (
            <option key={f.v} value={f.v}>{f.l}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>Start / next date</Label>
        <Input type="date" value={p.startDate} onChange={(e) => p.setStartDate(e.target.value)} />
      </div>
      <div>
        <Label>Ends</Label>
        <select className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={p.endMode} onChange={(e) => p.setEndMode(e.target.value as any)}>
          <option value="none">Until cancelled</option>
          <option value="date">On a date</option>
          <option value="count">After N payments</option>
        </select>
      </div>
      {p.endMode === 'date' && (
        <div>
          <Label>End date</Label>
          <Input type="date" min={p.startDate} value={p.endDate} onChange={(e) => p.setEndDate(e.target.value)} />
        </div>
      )}
      {p.endMode === 'count' && (
        <div>
          <Label># of payments</Label>
          <Input inputMode="numeric" placeholder="e.g. 12" value={p.maxOccurrences} onChange={(e) => p.setMaxOccurrences(e.target.value)} />
        </div>
      )}
    </div>
  )
}

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

  // Shared allocation
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [allocTotal, setAllocTotal] = useState(0)

  // Check fields
  const [checkNumber, setCheckNumber] = useState('')
  const [checkDate, setCheckDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [bankName, setBankName] = useState('')
  const [memo, setMemo] = useState('')

  // Card
  const [cards, setCards] = useState<CardRow[]>([])
  const [cardId, setCardId] = useState('')
  const [showAddCard, setShowAddCard] = useState(false)
  const [chargeNow, setChargeNow] = useState(true)
  const idemRef = useRef<string>('')

  // Other
  const [otherLabel, setOtherLabel] = useState('Cash')

  // Amount + recurring (shared across flows)
  const [amount, setAmount] = useState('')
  const [makeRecurring, setMakeRecurring] = useState(false)
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
      setAmount(balance && balance > 0 ? String(balance) : '')
      setCheckNumber('')
      setBankName('')
      setMemo('')
      setMakeRecurring(false)
      setChargeNow(true)
      setEndMode('none')
      setOtherLabel('Cash')
      idemRef.current = (globalThis.crypto?.randomUUID?.() || String(Date.now() + Math.random()))
    }
  }, [open, balance])

  // Load saved cards when entering the card flow.
  useEffect(() => {
    if (!open || view !== 'card') return
    ;(async () => {
      const res = await fetch(`/api/clients/${clientId}/cards`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setCards(data.cards || [])
        setCardId(data.cards?.find((c: CardRow) => c.isDefault)?.id || data.cards?.[0]?.id || '')
      }
    })()
  }, [open, view, clientId])

  const recurringBody = (extra: Record<string, any>) => ({
    clientId,
    invoiceId,
    amount: Number(amount),
    frequency,
    startDate,
    endDate: endMode === 'date' ? endDate : null,
    maxOccurrences: endMode === 'count' ? Number(maxOccurrences) : null,
    ...extra,
  })

  const post = async (url: string, body: any) => {
    const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  }

  const finish = () => {
    onOpenChange(false)
    onDone?.()
  }

  // ---- Check ----
  const submitCheck = async () => {
    setError(null)
    if (!(Number(amount) > 0)) return setError('Enter a check amount greater than zero.')
    if (makeRecurring) {
      setBusy(true)
      const { ok, data } = await post('/api/recurring-payments', recurringBody({ type: 'CUSTOM', method: 'CHECK' }))
      setBusy(false)
      if (!ok) return setError(data.error || 'Failed to create the recurring check.')
      return finish()
    }
    if (allocTotal > Number(amount) + 0.005) return setError('Applied amount exceeds the check amount.')
    if (allocations.length === 0) return setError('Select at least one invoice to apply this check to.')
    setBusy(true)
    const refParts = [checkNumber && `Check #${checkNumber}`, bankName, memo].filter(Boolean)
    const { ok, data } = await post(`/api/invoices/${invoiceId}/record-payment`, {
      method: 'CHECK',
      amount: Number(amount),
      reference: refParts.join(' · ') || undefined,
      paidAt: checkDate,
      allocations,
    })
    setBusy(false)
    if (!ok) return setError(data.error || 'Failed to record the check.')
    if (data.paymentId) {
      onOpenChange(false)
      router.push(`/dashboard/payments/${data.paymentId}`)
    } else finish()
  }

  // ---- Card ----
  const submitCard = async () => {
    setError(null)
    if (!chargeNow && !makeRecurring) return setError('Choose to charge now, set up recurring, or both.')
    if (!cardId) return setError('Add or choose a saved card.')
    if (chargeNow) {
      if (allocations.length === 0) return setError('Select at least one invoice to apply the charge to.')
      setBusy(true)
      const { ok, data } = await post('/api/payments/charge-card', {
        clientId,
        cardOnFileId: cardId,
        allocations,
        memo: memo || undefined,
        idempotencyKey: idemRef.current,
      })
      if (!ok) {
        setBusy(false)
        return setError(data.error || 'The card charge failed.')
      }
      // Separate record: optionally also create the recurring schedule.
      if (makeRecurring) {
        if (!(Number(amount) > 0)) {
          setBusy(false)
          setInfo('Payment charged. Enter a recurring amount to also set up the schedule.')
          onDone?.()
          return
        }
        const r = await post('/api/recurring-payments', recurringBody({ type: 'CARD', cardOnFileId: cardId }))
        setBusy(false)
        if (!r.ok) {
          // The charge SUCCEEDED; only the schedule failed — never re-charge.
          setInfo(`Payment charged (ref ${data.refNum || 'ok'}). The recurring schedule could not be created: ${r.data.error || 'error'}.`)
          onDone?.()
          return
        }
        onDone?.()
        return finish()
      }
      setBusy(false)
      return finish()
    }
    // Recurring only (no immediate charge)
    if (!(Number(amount) > 0)) return setError('Enter a recurring amount greater than zero.')
    setBusy(true)
    const { ok, data } = await post('/api/recurring-payments', recurringBody({ type: 'CARD', cardOnFileId: cardId }))
    setBusy(false)
    if (!ok) return setError(data.error || 'Failed to create the recurring charge.')
    return finish()
  }

  // ---- Other ----
  const submitOther = async () => {
    setError(null)
    if (!otherLabel.trim()) return setError('Choose a payment type.')
    if (!(Number(amount) > 0)) return setError('Enter an amount greater than zero.')
    if (makeRecurring) {
      setBusy(true)
      const { ok, data } = await post('/api/recurring-payments', recurringBody({ type: 'CUSTOM', method: 'OTHER', methodLabel: otherLabel.trim() }))
      setBusy(false)
      if (!ok) return setError(data.error || 'Failed to create the recurring payment.')
      return finish()
    }
    if (allocTotal > Number(amount) + 0.005) return setError('Applied amount exceeds the payment amount.')
    if (allocations.length === 0) return setError('Select at least one invoice to apply this payment to.')
    setBusy(true)
    const { ok, data } = await post(`/api/invoices/${invoiceId}/record-payment`, {
      method: 'OTHER',
      methodLabel: otherLabel.trim(),
      amount: Number(amount),
      reference: memo || undefined,
      paidAt: new Date().toISOString().slice(0, 10),
      allocations,
    })
    setBusy(false)
    if (!ok) return setError(data.error || 'Failed to record the payment.')
    if (data.paymentId) {
      onOpenChange(false)
      router.push(`/dashboard/payments/${data.paymentId}`)
    } else finish()
  }

  // ---- ACH / Quick Pay (reuse existing flows) ----
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
  const goQuickPay = () => {
    onOpenChange(false)
    router.push(`/dashboard/payments/new?invoiceId=${invoiceId}&method=QUICK_PAY`)
  }

  const Hub = (
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        { key: 'check', icon: Check, title: 'Check', desc: 'Record a check, apply it to invoices, optionally schedule recurring checks.', btn: 'Apply Check', onClick: () => setView('check') },
        { key: 'card', icon: CreditCard, title: 'Credit Card', desc: 'Charge a card, apply to invoices, optionally set up recurring card payments.', btn: 'Pay with Credit Card', onClick: () => setView('card') },
        { key: 'ach', icon: Banknote, title: 'ACH', desc: 'Start a bank (ACH) payment using your existing ACH flow.', btn: 'Go to ACH', onClick: goAch },
        { key: 'quickpay', icon: Zap, title: 'Quick Pay', desc: 'Open the existing Quick Pay flow for a fast customer payment.', btn: 'Open Quick Pay', onClick: goQuickPay },
        { key: 'other', icon: MoreHorizontal, title: 'Other', desc: 'Record a payment received by cash, wire, money order, or another method.', btn: 'Record Other Payment', onClick: () => setView('other') },
      ].map((c) => {
        const Icon = c.icon
        return (
          <div key={c.key} className="flex flex-col rounded-lg border p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <h3 className="font-semibold text-gray-900">{c.title}</h3>
            </div>
            <p className="mb-3 flex-1 text-xs text-gray-500">{c.desc}</p>
            <Button type="button" size="sm" variant={c.key === 'ach' || c.key === 'quickpay' ? 'outline' : 'default'} onClick={c.onClick} disabled={busy}>
              {c.btn}
            </Button>
          </div>
        )
      })}
    </div>
  )

  const recurringToggle = (label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={makeRecurring} onChange={(e) => setMakeRecurring(e.target.checked)} />
      {label}
    </label>
  )

  const recurringFields = (
    <RecurringFields
      frequency={frequency} setFrequency={setFrequency}
      startDate={startDate} setStartDate={setStartDate}
      endMode={endMode} setEndMode={setEndMode}
      endDate={endDate} setEndDate={setEndDate}
      maxOccurrences={maxOccurrences} setMaxOccurrences={setMaxOccurrences}
    />
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view !== 'hub' && (
              <button type="button" onClick={() => setView('hub')} className="text-gray-400 hover:text-gray-700">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {view === 'hub' ? 'Receive Payment' : view === 'check' ? 'Check payment' : view === 'card' ? 'Credit card payment' : 'Other payment'}
          </DialogTitle>
          <DialogDescription>
            {view === 'hub' ? 'Choose a payment method.' : 'Apply the payment across the customer’s open invoices.'}
          </DialogDescription>
        </DialogHeader>

        {view === 'hub' && Hub}

        {view === 'check' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Check #</Label><Input value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} /></div>
              <div><Label>Check date</Label><Input type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} /></div>
              <div><Label>Bank name</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
              <div><Label>Amount</Label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            </div>
            <div><Label>Memo / notes</Label><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
            {!makeRecurring && <InvoiceAllocator invoiceId={invoiceId} paymentAmount={Number(amount) || undefined} onChange={(a, t) => { setAllocations(a); setAllocTotal(t) }} />}
            {recurringToggle('Create recurring check payment (auto-recorded each cycle)')}
            {makeRecurring && recurringFields}
            {makeRecurring && <p className="text-xs text-gray-500">A check payment of {formatCurrency(Number(amount) || 0)} is recorded automatically each cycle and applied to this invoice. No funds are collected by the system.</p>}
          </div>
        )}

        {view === 'card' && (
          <div className="space-y-3">
            <div>
              <Label>Card</Label>
              {cards.length === 0 ? (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-gray-500">No saved card.</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowAddCard(true)}>Add card</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <select className="h-10 flex-1 rounded-md border border-gray-300 bg-white px-2 text-sm" value={cardId} onChange={(e) => setCardId(e.target.value)}>
                    {cards.map((c) => (<option key={c.id} value={c.id}>{(c.cardType || 'Card') + ' ' + (c.maskedCard || '')}</option>))}
                  </select>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddCard(true)}>Add</Button>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chargeNow} onChange={(e) => setChargeNow(e.target.checked)} />
              Charge the card now
            </label>
            {chargeNow && <InvoiceAllocator invoiceId={invoiceId} paymentAmount={undefined} onChange={(a, t) => { setAllocations(a); setAllocTotal(t) }} />}
            {chargeNow && <div className="text-right text-sm font-semibold">Total to charge: {formatCurrency(allocTotal)}</div>}
            <div><Label>Memo (optional)</Label><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></div>

            {recurringToggle('Set up recurring credit card payments')}
            {makeRecurring && (
              <>
                <div><Label>Recurring amount</Label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                {recurringFields}
                <p className="text-xs text-gray-500">The recurring schedule is a separate record from any charge made now.</p>
              </>
            )}
          </div>
        )}

        {view === 'other' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Payment type</Label>
                <select className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)}>
                  <option>Cash</option>
                  <option>Wire transfer</option>
                  <option>Money order</option>
                  <option>Other</option>
                </select>
              </div>
              <div><Label>Amount</Label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            </div>
            <div><Label>Reference / memo</Label><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
            {!makeRecurring && <InvoiceAllocator invoiceId={invoiceId} paymentAmount={Number(amount) || undefined} onChange={(a, t) => { setAllocations(a); setAllocTotal(t) }} />}
            {recurringToggle('Make recurring (auto-recorded each cycle)')}
            {makeRecurring && recurringFields}
            {makeRecurring && <p className="text-xs text-gray-500">Auto-records a {otherLabel} payment each cycle. The system does not collect funds itself.</p>}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {info && <p className="text-sm text-green-700">{info}</p>}

        {view !== 'hub' && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => setView('hub')} disabled={busy}>Back</Button>
            <Button onClick={view === 'check' ? submitCheck : view === 'card' ? submitCard : submitOther} disabled={busy}>
              {busy ? 'Working…' : view === 'check' ? (makeRecurring ? 'Create recurring check' : 'Record check') : view === 'card' ? (chargeNow ? 'Confirm & charge' : 'Create recurring charge') : (makeRecurring ? 'Create recurring payment' : 'Record payment')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>

      <SaveCardDialog
        clientId={clientId}
        open={showAddCard}
        onOpenChange={setShowAddCard}
        onSaved={async () => {
          const res = await fetch(`/api/clients/${clientId}/cards`, { headers: authHeaders() })
          const data = await res.json().catch(() => ({}))
          if (res.ok) {
            setCards(data.cards || [])
            setCardId(data.cards?.[0]?.id || '')
          }
        }}
      />
    </Dialog>
  )
}
