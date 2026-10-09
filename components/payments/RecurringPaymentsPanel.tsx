'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CreditCard, Plus, Repeat, Trash2, Pause, Play, X, Zap } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SaveCardDialog } from '@/components/payments/SaveCardDialog'

interface CardRow {
  id: string
  maskedCard: string | null
  cardType: string | null
  expMonth: number | null
  expYear: number | null
  label: string | null
  isDefault: boolean
}

interface RecurringRow {
  id: string
  invoiceId: string | null
  type?: string
  method?: string | null
  methodLabel?: string | null
  amount: string | number
  frequency: string
  startDate: string
  nextRunAt: string
  endDate: string | null
  maxOccurrences: number | null
  occurrences: number
  status: string
  lastError: string | null
  card?: { maskedCard: string | null; cardType: string | null }
  _count?: { runs: number }
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-gray-100 text-gray-500',
  FAILED: 'bg-red-100 text-red-700',
}

const FREQ_LABEL: Record<string, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every 2 weeks',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
}

const METHOD_LABEL: Record<string, string> = {
  CHECK: 'Check',
  QUICK_PAY: 'Quick Pay',
  OTHER: 'Other',
}

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export function RecurringPaymentsPanel(props: {
  clientId: string
  invoiceId?: string
  defaultAmount?: number
  title?: string
}) {
  const { clientId, invoiceId, defaultAmount, title } = props
  const [cards, setCards] = useState<CardRow[]>([])
  const [recurring, setRecurring] = useState<RecurringRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddCard, setShowAddCard] = useState(false)
  const [showNewSchedule, setShowNewSchedule] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // New-schedule form
  const [cardId, setCardId] = useState('')
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '')
  const [frequency, setFrequency] = useState('MONTHLY')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [endMode, setEndMode] = useState<'none' | 'date' | 'count'>('none')
  const [endDate, setEndDate] = useState('')
  const [maxOccurrences, setMaxOccurrences] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ clientId })
      if (invoiceId) qs.set('invoiceId', invoiceId)
      const [cardsRes, recRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/cards`, { headers: authHeaders() }),
        fetch(`/api/recurring-payments?${qs}`, { headers: authHeaders() }),
      ])
      const cardsData = await cardsRes.json().catch(() => ({}))
      const recData = await recRes.json().catch(() => ({}))
      if (cardsRes.ok) setCards(cardsData.cards || [])
      if (recRes.ok) setRecurring(recData.recurringPayments || [])
    } catch {
      setError('Failed to load recurring payments.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (clientId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, invoiceId])

  const createSchedule = async () => {
    setError(null)
    if (!cardId) return setError('Choose a saved card.')
    if (!(Number(amount) > 0)) return setError('Enter an amount greater than zero.')
    setSubmitting(true)
    try {
      const res = await fetch('/api/recurring-payments', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          clientId,
          invoiceId: invoiceId || null,
          cardOnFileId: cardId,
          amount: Number(amount),
          frequency,
          startDate,
          endDate: endMode === 'date' ? endDate : null,
          maxOccurrences: endMode === 'count' ? Number(maxOccurrences) : null,
          notes: notes.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      setSubmitting(false)
      if (!res.ok) return setError(data.error || 'Failed to create the recurring payment.')
      setShowNewSchedule(false)
      setNotes('')
      await load()
    } catch {
      setSubmitting(false)
      setError('Failed to create the recurring payment.')
    }
  }

  const act = async (id: string, action: string) => {
    if (action === 'cancel' && !confirm('Cancel this recurring payment? It will stop charging.')) return
    if (action === 'charge_now' && !confirm('Charge this card now for the scheduled amount?')) return
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/recurring-payments/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError(data.error || (data.result?.error ? `Charge failed: ${data.result.error}` : 'Action failed.'))
      await load()
    } catch {
      setError('Action failed.')
    } finally {
      setBusyId(null)
    }
  }

  const removeCard = async (id: string) => {
    if (!confirm('Remove this saved card? Any active recurring payments on it will be cancelled.')) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/cards/${id}`, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to remove card.')
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Repeat className="h-4 w-4" />
            {title || 'Recurring card payments'}
          </CardTitle>
          <CardDescription>
            Charge a saved card automatically on a schedule. Staff-only — not shown to customers.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Cards on file */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Cards on file</h3>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowAddCard(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add card
            </Button>
          </div>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : cards.length === 0 ? (
            <p className="text-sm text-gray-500">No cards saved yet.</p>
          ) : (
            <div className="space-y-2">
              {cards.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <CreditCard className="h-4 w-4 text-gray-400" />
                    <span className="font-medium">{c.cardType || 'Card'}</span>
                    <span className="text-gray-500">{c.maskedCard || '••••'}</span>
                    {c.expMonth && c.expYear && (
                      <span className="text-xs text-gray-400">
                        exp {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                      </span>
                    )}
                    {c.label && <span className="text-xs text-gray-400">· {c.label}</span>}
                    {c.isDefault && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                        Default
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={busyId === c.id}
                    onClick={() => removeCard(c.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recurring schedules */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Schedules</h3>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setShowNewSchedule((v) => !v)
                setCardId(cards.find((c) => c.isDefault)?.id || cards[0]?.id || '')
              }}
              disabled={cards.length === 0}
              title={cards.length === 0 ? 'Add a card first' : undefined}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> New recurring payment
            </Button>
          </div>

          {showNewSchedule && (
            <div className="mb-4 space-y-3 rounded-md border bg-gray-50 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Card</Label>
                  <select
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                    value={cardId}
                    onChange={(e) => setCardId(e.target.value)}
                  >
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {(c.cardType || 'Card') + ' ' + (c.maskedCard || '')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="rpAmount">Amount</Label>
                  <Input
                    id="rpAmount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Frequency</Label>
                  <select
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                  >
                    <option value="WEEKLY">Weekly</option>
                    <option value="BIWEEKLY">Every 2 weeks</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="rpStart">First charge date</Label>
                  <Input id="rpStart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Ends</Label>
                  <select
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                    value={endMode}
                    onChange={(e) => setEndMode(e.target.value as any)}
                  >
                    <option value="none">Until cancelled</option>
                    <option value="date">On a date</option>
                    <option value="count">After N payments</option>
                  </select>
                </div>
                {endMode === 'date' && (
                  <div>
                    <Label htmlFor="rpEnd">End date</Label>
                    <Input id="rpEnd" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                )}
                {endMode === 'count' && (
                  <div>
                    <Label htmlFor="rpCount"># of payments</Label>
                    <Input
                      id="rpCount"
                      inputMode="numeric"
                      placeholder="e.g. 12"
                      value={maxOccurrences}
                      onChange={(e) => setMaxOccurrences(e.target.value)}
                    />
                  </div>
                )}
              </div>
              {invoiceId && (
                <p className="text-xs text-gray-500">
                  Applied to this invoice; it completes automatically once the invoice is paid.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewSchedule(false)}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={createSchedule} disabled={submitting}>
                  {submitting ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </div>
          )}

          {loading ? null : recurring.length === 0 ? (
            <p className="text-sm text-gray-500">No recurring payments set up.</p>
          ) : (
            <div className="space-y-2">
              {recurring.map((r) => {
                const active = r.status === 'ACTIVE'
                const paused = r.status === 'PAUSED'
                return (
                  <div key={r.id} className="rounded border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold">{formatCurrency(Number(r.amount))}</span>
                        <span className="text-gray-500">{FREQ_LABEL[r.frequency] || r.frequency}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'}`}
                        >
                          {r.status}
                        </span>
                        {r.type === 'CUSTOM' ? (
                          <span className="text-xs text-gray-400">
                            {r.method === 'OTHER' ? (r.methodLabel || 'Other') : METHOD_LABEL[r.method || ''] || 'Custom'} (auto-record)
                          </span>
                        ) : r.card?.maskedCard ? (
                          <span className="text-xs text-gray-400">{r.card.cardType} {r.card.maskedCard}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        {active && (
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === r.id} onClick={() => act(r.id, 'charge_now')} title="Charge now">
                            <Zap className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {active && (
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === r.id} onClick={() => act(r.id, 'pause')} title="Pause">
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {paused && (
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === r.id} onClick={() => act(r.id, 'resume')} title="Resume">
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {(active || paused) && (
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === r.id} onClick={() => act(r.id, 'cancel')} title="Cancel">
                            <X className="h-3.5 w-3.5 text-red-600" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {active || paused ? `Next charge ${formatDate(r.nextRunAt)}` : `Ended`} ·{' '}
                      {r.occurrences} charged
                      {r.maxOccurrences ? ` of ${r.maxOccurrences}` : ''}
                      {r.endDate ? ` · ends ${formatDate(r.endDate)}` : ''}
                    </div>
                    {r.lastError && r.status === 'FAILED' && (
                      <div className="mt-1 text-xs text-red-600">Last error: {r.lastError}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </CardContent>

      <SaveCardDialog clientId={clientId} open={showAddCard} onOpenChange={setShowAddCard} onSaved={load} />
    </Card>
  )
}
