'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

type OpenInvoice = { invoiceId: string; invoiceNumber: string; total: number; balance: number }
type Context = {
  clientId: string
  clientName: string
  currentInvoiceId: string
  openInvoices: OpenInvoice[]
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))
}
function r2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function NewPaymentInner() {
  const router = useRouter()
  const search = useSearchParams()
  const invoiceId = String(search.get('invoiceId') || '')

  const [ctx, setCtx] = useState<Context | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'CHECK' | 'QUICK_PAY' | 'OTHER'>('CHECK')
  const [otherLabel, setOtherLabel] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [reference, setReference] = useState('')
  const [alloc, setAlloc] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!invoiceId) {
      setError('Missing invoice context')
      setLoading(false)
      return
    }
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/payment-context`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to load')
      const data: Context = await res.json()
      setCtx(data)
      const init: Record<string, string> = {}
      for (const inv of data.openInvoices) init[inv.invoiceId] = ''
      setAlloc(init)
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  useEffect(() => {
    load()
  }, [load])

  const amountNum = r2(parseFloat(amount) || 0)
  const sumAlloc = useMemo(
    () => r2(Object.values(alloc).reduce((s, v) => s + (parseFloat(v) || 0), 0)),
    [alloc]
  )
  const credit = r2(amountNum - sumAlloc)
  const over = sumAlloc > amountNum + 0.005

  const autoSplit = () => {
    if (!ctx) return
    let remaining = amountNum
    const next: Record<string, string> = {}
    for (const inv of ctx.openInvoices) {
      const take = r2(Math.min(remaining, inv.balance))
      next[inv.invoiceId] = take > 0 ? take.toFixed(2) : ''
      remaining = r2(remaining - Math.max(0, take))
    }
    setAlloc(next)
  }

  const save = async () => {
    if (!ctx) return
    setError(null)
    if (amountNum <= 0) {
      setError('Enter a payment amount greater than zero.')
      return
    }
    if (method === 'OTHER' && !otherLabel.trim()) {
      setError('Enter a payment type name.')
      return
    }
    if (over) {
      setError('Applied amounts exceed the payment total.')
      return
    }
    setSaving(true)
    try {
      const allocations = ctx.openInvoices
        .map((inv) => ({ invoiceId: inv.invoiceId, amount: parseFloat(alloc[inv.invoiceId] || '0') || 0 }))
        .filter((a) => a.amount > 0)
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/record-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          amount: amountNum,
          method,
          methodLabel: method === 'OTHER' ? otherLabel.trim() : undefined,
          paidAt: date,
          reference: reference.trim() || undefined,
          allocations,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to record payment.')
        return
      }
      if (data.paymentId) router.push(`/dashboard/payments/${data.paymentId}`)
      else router.push(`/dashboard/invoices/${invoiceId}`)
    } catch {
      setError('Failed to record payment. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>
  if (!ctx) return <div className="p-6 text-sm text-red-600">{error || 'Unable to start a payment'}</div>

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">
        ← Back
      </button>

      <div className="mt-3 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">New payment · {ctx.clientName}</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-3xl font-extrabold text-gray-400">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              autoFocus
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-56 rounded-lg border border-gray-300 px-3 py-2 text-3xl font-extrabold text-gray-900"
            />
            <button
              type="button"
              onClick={autoSplit}
              disabled={amountNum <= 0}
              className="ml-auto rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Auto-split
            </button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs text-gray-500">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as any)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="CHECK">Check</option>
                <option value="QUICK_PAY">Quick Pay</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Reference</label>
              <input
                placeholder="Check # / note"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          {method === 'OTHER' && (
            <div className="mt-3">
              <label className="text-xs text-gray-500">Payment type name</label>
              <input
                placeholder="e.g. Cash, Zelle, Venmo"
                value={otherLabel}
                onChange={(e) => setOtherLabel(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          )}
        </div>

        <div className="p-5">
          <div className="mb-2 text-sm font-semibold text-gray-700">Apply to open invoices</div>
          {ctx.openInvoices.length === 0 ? (
            <p className="text-sm text-gray-500">This customer has no open invoices. The full amount will be held as credit.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">Invoice</th>
                  <th className="py-2 px-4 text-right">Open Balance</th>
                  <th className="py-2 pl-4 text-right">Apply</th>
                </tr>
              </thead>
              <tbody>
                {ctx.openInvoices.map((inv) => (
                  <tr key={inv.invoiceId} className="border-b border-gray-100">
                    <td className="py-2 pr-4">
                      <Link href={`/dashboard/invoices/${inv.invoiceId}`} className="font-medium text-blue-600 hover:underline">
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="py-2 px-4 text-right text-gray-600">{money(inv.balance)}</td>
                    <td className="py-2 pl-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-gray-400">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          max={inv.balance}
                          value={alloc[inv.invoiceId] ?? ''}
                          onChange={(e) => setAlloc((prev) => ({ ...prev, [inv.invoiceId]: e.target.value }))}
                          className="w-28 rounded border border-gray-300 px-2 py-1 text-right"
                        />
                        <button
                          type="button"
                          className="ml-1 text-xs text-blue-600 hover:underline"
                          onClick={() => setAlloc((prev) => ({ ...prev, [inv.invoiceId]: inv.balance.toFixed(2) }))}
                        >
                          max
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className={`mt-3 rounded-md px-4 py-3 text-sm ${over ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'}`}>
            Applying {money(sumAlloc)} of {money(amountNum)} ·{' '}
            {over ? 'over the payment total!' : `${money(credit)} held as credit`}
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving || over || amountNum <= 0}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Record payment'}
            </button>
            <button
              onClick={() => router.back()}
              disabled={saving}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NewPaymentPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}>
      <NewPaymentInner />
    </Suspense>
  )
}
