'use client'

import { useEffect, useState } from 'react'
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
import { Check, CreditCard, Banknote, Zap, MoreHorizontal } from 'lucide-react'
import { SaveCardDialog } from '@/components/payments/SaveCardDialog'

type Method = 'CHECK' | 'CARD' | 'ACH' | 'QUICK_PAY' | 'OTHER'

const METHODS: { key: Method; label: string; icon: any; recurring: boolean }[] = [
  { key: 'CHECK', label: 'Check', icon: Check, recurring: true },
  { key: 'CARD', label: 'Credit card', icon: CreditCard, recurring: true },
  { key: 'ACH', label: 'ACH', icon: Banknote, recurring: false },
  { key: 'QUICK_PAY', label: 'Quick Pay', icon: Zap, recurring: true },
  { key: 'OTHER', label: 'Other', icon: MoreHorizontal, recurring: true },
]

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

export function ReceivePaymentModal(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  clientId: string
  balance?: number
  onDone?: () => void
}) {
  const { open, onOpenChange, invoiceId, clientId, balance, onDone } = props

  const [method, setMethod] = useState<Method>('CHECK')
  const [amount, setAmount] = useState('')
  const [otherLabel, setOtherLabel] = useState('')
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const [makeRecurring, setMakeRecurring] = useState(false)

  const [frequency, setFrequency] = useState('MONTHLY')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [endMode, setEndMode] = useState<'none' | 'date' | 'count'>('none')
  const [endDate, setEndDate] = useState('')
  const [maxOccurrences, setMaxOccurrences] = useState('')

  const [cards, setCards] = useState<CardRow[]>([])
  const [cardId, setCardId] = useState('')
  const [showAddCard, setShowAddCard] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [achUrl, setAchUrl] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setMethod('CHECK')
      setAmount(balance && balance > 0 ? String(balance) : '')
      setOtherLabel('')
      setReference('')
      setMakeRecurring(false)
      setEndMode('none')
      setError(null)
      setInfo(null)
      setAchUrl(null)
    }
  }, [open, balance])

  // Load saved cards when setting up a recurring card payment.
  useEffect(() => {
    if (!open) return
    if (method !== 'CARD' || !makeRecurring) return
    ;(async () => {
      const res = await fetch(`/api/clients/${clientId}/cards`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setCards(data.cards || [])
        setCardId(data.cards?.find((c: CardRow) => c.isDefault)?.id || data.cards?.[0]?.id || '')
      }
    })()
  }, [open, method, makeRecurring, clientId])

  const recurringSupported = METHODS.find((m) => m.key === method)?.recurring
  const isCustom = method === 'CHECK' || method === 'QUICK_PAY' || method === 'OTHER'

  const recurringPayload = () => ({
    clientId,
    invoiceId,
    frequency,
    startDate,
    endDate: endMode === 'date' ? endDate : null,
    maxOccurrences: endMode === 'count' ? Number(maxOccurrences) : null,
    amount: Number(amount),
  })

  const submit = async () => {
    setError(null)
    setInfo(null)

    // ACH — generate a hosted link.
    if (method === 'ACH') {
      setSubmitting(true)
      try {
        const res = await fetch('/api/payments/qbo/ach/create-session', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ invoiceId }),
        })
        const data = await res.json().catch(() => ({}))
        setSubmitting(false)
        if (!res.ok) return setError(data.error || 'Failed to create ACH link.')
        const url = data.hostedUrl || data.publicUrl
        setAchUrl(url || null)
        if (url) window.open(url, '_blank', 'noopener,noreferrer')
        setInfo('ACH payment link created.')
      } catch {
        setSubmitting(false)
        setError('Failed to create ACH link.')
      }
      return
    }

    // Credit card, one-time — open the secure payment page.
    if (method === 'CARD' && !makeRecurring) {
      setSubmitting(true)
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/portal-pay-url`, {
          method: 'POST',
          headers: authHeaders(),
        })
        const data = await res.json().catch(() => ({}))
        setSubmitting(false)
        if (!res.ok || !data?.portalUrl) return setError(data.error || 'Unable to open the payment page.')
        window.open(data.portalUrl, '_blank', 'noopener,noreferrer')
        onOpenChange(false)
        onDone?.()
      } catch {
        setSubmitting(false)
        setError('Unable to open the payment page.')
      }
      return
    }

    // Recurring (card or custom).
    if (makeRecurring) {
      if (!(Number(amount) > 0)) return setError('Enter an amount greater than zero.')
      if (method === 'CARD' && !cardId) return setError('Add or choose a saved card.')
      if (method === 'OTHER' && !otherLabel.trim()) return setError('Enter a payment type name.')
      setSubmitting(true)
      try {
        const body =
          method === 'CARD'
            ? { ...recurringPayload(), type: 'CARD', cardOnFileId: cardId }
            : { ...recurringPayload(), type: 'CUSTOM', method, methodLabel: method === 'OTHER' ? otherLabel.trim() : undefined }
        const res = await fetch('/api/recurring-payments', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        setSubmitting(false)
        if (!res.ok) return setError(data.error || 'Failed to create the recurring payment.')
        onOpenChange(false)
        onDone?.()
      } catch {
        setSubmitting(false)
        setError('Failed to create the recurring payment.')
      }
      return
    }

    // Custom, one-time — record a payment.
    if (isCustom) {
      if (!(Number(amount) > 0)) return setError('Enter an amount greater than zero.')
      if (method === 'OTHER' && !otherLabel.trim()) return setError('Enter a payment type name.')
      setSubmitting(true)
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/record-payment`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            method,
            methodLabel: method === 'OTHER' ? otherLabel.trim() : undefined,
            amount: Number(amount),
            reference: reference.trim() || undefined,
            paidAt,
          }),
        })
        const data = await res.json().catch(() => ({}))
        setSubmitting(false)
        if (!res.ok) return setError(data.error || 'Failed to record the payment.')
        onOpenChange(false)
        onDone?.()
      } catch {
        setSubmitting(false)
        setError('Failed to record the payment.')
      }
      return
    }
  }

  const submitLabel =
    method === 'ACH'
      ? 'Create ACH link'
      : method === 'CARD'
        ? makeRecurring ? 'Create recurring charge' : 'Open payment page'
        : makeRecurring ? 'Create recurring payment' : 'Record payment'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Receive payment</DialogTitle>
          <DialogDescription>Choose how the customer is paying.</DialogDescription>
        </DialogHeader>

        {/* Method picker */}
        <div className="grid grid-cols-5 gap-2">
          {METHODS.map((m) => {
            const Icon = m.icon
            const active = method === m.key
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setMethod(m.key)
                  if (!METHODS.find((x) => x.key === m.key)?.recurring) setMakeRecurring(false)
                  setError(null)
                  setInfo(null)
                  setAchUrl(null)
                }}
                className={`flex flex-col items-center gap-1 rounded-md border p-2 text-xs ${
                  active ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="h-4 w-4" />
                {m.label}
              </button>
            )
          })}
        </div>

        <div className="space-y-3">
          {method === 'ACH' ? (
            <p className="text-sm text-gray-600">
              Creates a secure bank (ACH) payment link for this invoice and opens it in a new tab.
            </p>
          ) : (
            <>
              {/* Amount (not needed for one-time card, which uses the invoice balance on the page) */}
              {!(method === 'CARD' && !makeRecurring) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="rpvAmount">Amount</Label>
                    <Input id="rpvAmount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  {method === 'OTHER' && (
                    <div>
                      <Label htmlFor="rpvLabel">Payment type name</Label>
                      <Input id="rpvLabel" placeholder="e.g. Cash, Zelle" value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)} />
                    </div>
                  )}
                  {isCustom && method !== 'OTHER' && !makeRecurring && (
                    <div>
                      <Label htmlFor="rpvRef">{method === 'CHECK' ? 'Check #' : 'Reference'} (optional)</Label>
                      <Input id="rpvRef" value={reference} onChange={(e) => setReference(e.target.value)} />
                    </div>
                  )}
                </div>
              )}

              {/* One-time custom: payment date */}
              {isCustom && !makeRecurring && (
                <div className="w-1/2 pr-1.5">
                  <Label htmlFor="rpvDate">Payment date</Label>
                  <Input id="rpvDate" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
                </div>
              )}

              {method === 'CARD' && !makeRecurring && (
                <p className="text-sm text-gray-600">
                  Opens the secure card payment page for this invoice in a new tab.
                </p>
              )}

              {/* Recurring toggle */}
              {recurringSupported && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={makeRecurring} onChange={(e) => setMakeRecurring(e.target.checked)} />
                  Make recurring
                </label>
              )}

              {/* Recurring: card selector for CARD */}
              {makeRecurring && method === 'CARD' && (
                <div>
                  <Label>Card to charge</Label>
                  {cards.length === 0 ? (
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-gray-500">No saved card.</p>
                      <Button type="button" size="sm" variant="outline" onClick={() => setShowAddCard(true)}>
                        Add card on file
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <select
                        className="h-10 flex-1 rounded-md border border-gray-300 bg-white px-2 text-sm"
                        value={cardId}
                        onChange={(e) => setCardId(e.target.value)}
                      >
                        {cards.map((c) => (
                          <option key={c.id} value={c.id}>
                            {(c.cardType || 'Card') + ' ' + (c.maskedCard || '')}
                          </option>
                        ))}
                      </select>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddCard(true)}>
                        Add
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Recurring: schedule fields */}
              {makeRecurring && (
                <div className="space-y-3 rounded-md border bg-gray-50 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Frequency</Label>
                      <select className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                        <option value="WEEKLY">Weekly</option>
                        <option value="BIWEEKLY">Every 2 weeks</option>
                        <option value="MONTHLY">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="rpvStart">First charge date</Label>
                      <Input id="rpvStart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Ends</Label>
                      <select className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={endMode} onChange={(e) => setEndMode(e.target.value as any)}>
                        <option value="none">Until cancelled</option>
                        <option value="date">On a date</option>
                        <option value="count">After N payments</option>
                      </select>
                    </div>
                    {endMode === 'date' && (
                      <div>
                        <Label htmlFor="rpvEnd">End date</Label>
                        <Input id="rpvEnd" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                      </div>
                    )}
                    {endMode === 'count' && (
                      <div>
                        <Label htmlFor="rpvCount"># of payments</Label>
                        <Input id="rpvCount" inputMode="numeric" placeholder="e.g. 12" value={maxOccurrences} onChange={(e) => setMaxOccurrences(e.target.value)} />
                      </div>
                    )}
                  </div>
                  {isCustom && (
                    <p className="text-xs text-gray-500">
                      Auto-records a {method === 'CHECK' ? 'check' : method === 'QUICK_PAY' ? 'Quick Pay' : otherLabel || 'custom'} payment each cycle. No card is charged.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-green-700">{info}</p>}
          {achUrl && (
            <a href={achUrl} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-blue-600 hover:underline">
              {achUrl}
            </a>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Working…' : submitLabel}
          </Button>
        </DialogFooter>
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
