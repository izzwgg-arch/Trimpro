'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

type Line = {
  paymentId: string
  invoiceId: string
  invoiceNumber: string
  amount: number
  invoiceTotal: number
  invoiceBalance: number
}
type OpenInvoice = { invoiceId: string; invoiceNumber: string; total: number; balance: number }
type PaymentView = {
  paymentId: string
  groupId: string | null
  clientId: string
  clientName: string
  method: string
  methodLabel: string
  provider: string | null
  reference: string | null
  paidAt: string | null
  totalReceived: number
  appliedTotal: number
  unapplied: number
  lines: Line[]
  openInvoices: OpenInvoice[]
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))
}
function r2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export default function PaymentPage() {
  const params = useParams()
  const router = useRouter()
  const paymentId = String(params?.paymentId || '')

  const [pay, setPay] = useState<PaymentView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [amounts, setAmounts] = useState<Record<string, string>>({})

  // Payment-level fields, editable in the same Edit mode as the allocation.
  const [metaAmount, setMetaAmount] = useState('')
  const [metaReference, setMetaReference] = useState('')
  const [metaDate, setMetaDate] = useState('')

  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/payments/${encodeURIComponent(paymentId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to load')
      const data = await res.json()
      setPay(data.payment)
    } catch (e: any) {
      setError(e?.message || 'Failed to load payment')
    } finally {
      setLoading(false)
    }
  }, [paymentId])

  useEffect(() => {
    load()
  }, [load])

  // All rows shown in edit mode: applied invoices first, then other open invoices.
  const editRows = useMemo(() => {
    if (!pay) return [] as Array<{ invoiceId: string; invoiceNumber: string; maxApplicable: number; current: number }>
    const rows = pay.lines.map((l) => ({
      invoiceId: l.invoiceId,
      invoiceNumber: l.invoiceNumber,
      // balance already excludes this payment; add back this payment's amount to get the cap
      maxApplicable: r2(l.invoiceBalance + l.amount),
      current: l.amount,
    }))
    for (const o of pay.openInvoices) {
      rows.push({ invoiceId: o.invoiceId, invoiceNumber: o.invoiceNumber, maxApplicable: o.balance, current: 0 })
    }
    return rows
  }, [pay])

  const isGrouped = Boolean(pay?.groupId)

  const startEdit = () => {
    if (!pay) return
    const init: Record<string, string> = {}
    for (const l of pay.lines) init[l.invoiceId] = l.amount.toFixed(2)
    for (const o of pay.openInvoices) init[o.invoiceId] = '0.00'
    setAmounts(init)
    setMetaAmount(pay.totalReceived.toFixed(2))
    setMetaReference(pay.reference || '')
    setMetaDate(pay.paidAt ? new Date(pay.paidAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0])
    setEditing(true)
    setError(null)
  }

  const sumApplied = useMemo(
    () => r2(Object.values(amounts).reduce((s, v) => s + (parseFloat(v) || 0), 0)),
    [amounts]
  )
  // While editing a single payment the total comes from the editable amount field;
  // grouped payments keep their computed total (amounts change per invoice).
  const editedTotal = pay ? (isGrouped ? pay.totalReceived : r2(parseFloat(metaAmount) || 0)) : 0
  const remainingUnapplied = r2(editedTotal - sumApplied)
  const overAllocated = sumApplied > editedTotal + 0.005

  const save = async () => {
    if (!pay) return
    setError(null)
    const amountNum = parseFloat(metaAmount)
    if (!isGrouped && (!metaAmount || Number.isNaN(amountNum) || amountNum <= 0)) {
      setError('Please enter a valid payment amount.')
      return
    }
    if (overAllocated) {
      setError('Applied amount is over the payment total.')
      return
    }
    setSaving(true)
    try {
      const token = localStorage.getItem('accessToken')
      // 1) Update the payment's own amount / reference / date.
      const metaBody: Record<string, unknown> = {
        reference: metaReference.trim() || null,
        paidAt: metaDate || undefined,
      }
      if (!isGrouped) metaBody.amount = amountNum
      const metaRes = await fetch(`/api/payments/${encodeURIComponent(paymentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(metaBody),
      })
      if (!metaRes.ok) {
        const d = await metaRes.json().catch(() => ({}))
        setError(d.error || 'Failed to update the payment.')
        return
      }
      // 2) Apply the (possibly new) total across invoices.
      const allocations = editRows.map((row) => ({
        invoiceId: row.invoiceId,
        amount: parseFloat(amounts[row.invoiceId] || '0') || 0,
      }))
      const res = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ allocations }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to apply the payment.')
        return
      }
      setEditing(false)
      await load()
      if (data.qboWarning) {
        setError(`Saved, but QuickBooks did not update: ${data.qboWarning}`)
      }
    } catch {
      setError('Failed to save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading payment…</div>
  if (!pay) return <div className="p-6 text-sm text-red-600">{error || 'Payment not found'}</div>

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">
        ← Back
      </button>

      <div className="mt-3 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payment</div>
              <div className="mt-1 text-3xl font-extrabold text-gray-900">{money(pay.totalReceived)}</div>
              <div className="mt-1 text-sm text-gray-600">{pay.clientName} · {pay.methodLabel}</div>
            </div>
            {!editing && (
              <button
                onClick={startEdit}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
              >
                Edit
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-gray-500">Applied</div>
              <div className="font-semibold text-gray-900">{money(editing ? sumApplied : pay.appliedTotal)}</div>
            </div>
            <div>
              <div className="text-gray-500">Unapplied</div>
              <div className={`font-semibold ${(editing ? remainingUnapplied : pay.unapplied) > 0 ? 'text-emerald-700' : 'text-gray-900'}`}>
                {money(editing ? remainingUnapplied : pay.unapplied)}
              </div>
            </div>
            <div>
              <div className="text-gray-500">Date</div>
              <div className="font-semibold text-gray-900">
                {pay.paidAt ? new Date(pay.paidAt).toLocaleDateString() : '—'}
              </div>
            </div>
          </div>
          {pay.reference && <div className="mt-2 text-xs text-gray-500">Reference: {pay.reference}</div>}
        </div>

        <div className="p-5">
          {!editing ? (
            <>
              <div className="mb-2 text-sm font-semibold text-gray-700">Applied to invoices</div>
              {pay.lines.length === 0 ? (
                <p className="text-sm text-gray-500">Not applied to any invoice (fully unapplied).</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-4">Invoice</th>
                      <th className="py-2 px-4 text-right">Invoice Total</th>
                      <th className="py-2 pl-4 text-right">Applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pay.lines.map((l) => (
                      <tr key={l.invoiceId} className="border-b border-gray-100">
                        <td className="py-2 pr-4">
                          <Link href={`/dashboard/invoices/${l.invoiceId}`} className="font-medium text-blue-600 hover:underline">
                            {l.invoiceNumber}
                          </Link>
                        </td>
                        <td className="py-2 px-4 text-right text-gray-600">{money(l.invoiceTotal)}</td>
                        <td className="py-2 pl-4 text-right font-semibold text-gray-900">{money(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <>
              {/* Payment fields — editable just like when first recording a payment. */}
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600">Payment amount</label>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400">$</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={metaAmount}
                      disabled={isGrouped}
                      onChange={(e) => setMetaAmount(e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  {isGrouped && (
                    <p className="text-[11px] text-gray-400">Split across invoices — set each amount below.</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600">Reference</label>
                  <input
                    type="text"
                    placeholder="Check #, transaction ID…"
                    value={metaReference}
                    onChange={(e) => setMetaReference(e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600">Date</label>
                  <input
                    type="date"
                    value={metaDate}
                    onChange={(e) => setMetaDate(e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1"
                  />
                </div>
              </div>

              <div className="mb-2 text-sm font-semibold text-gray-700">
                Apply this payment across invoices
              </div>
              <p className="mb-3 text-xs text-gray-500">
                Set how much of this {money(editedTotal)} payment applies to each invoice. Anything left over is
                held as the customer's account credit.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-4">Invoice</th>
                    <th className="py-2 px-4 text-right">Open Balance</th>
                    <th className="py-2 pl-4 text-right">Apply</th>
                  </tr>
                </thead>
                <tbody>
                  {editRows.map((row) => (
                    <tr key={row.invoiceId} className="border-b border-gray-100">
                      <td className="py-2 pr-4">
                        <Link href={`/dashboard/invoices/${row.invoiceId}`} className="font-medium text-blue-600 hover:underline">
                          {row.invoiceNumber}
                        </Link>
                      </td>
                      <td className="py-2 px-4 text-right text-gray-600">{money(row.maxApplicable)}</td>
                      <td className="py-2 pl-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-gray-400">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            max={row.maxApplicable}
                            value={amounts[row.invoiceId] ?? '0'}
                            onChange={(e) => setAmounts((prev) => ({ ...prev, [row.invoiceId]: e.target.value }))}
                            className="w-28 rounded border border-gray-300 px-2 py-1 text-right"
                          />
                          <button
                            type="button"
                            className="ml-1 text-xs text-blue-600 hover:underline"
                            onClick={() =>
                              setAmounts((prev) => ({ ...prev, [row.invoiceId]: row.maxApplicable.toFixed(2) }))
                            }
                            title="Apply full balance (capped by payment total)"
                          >
                            max
                          </button>
                          <button
                            type="button"
                            className="ml-1 text-xs text-gray-500 hover:underline"
                            onClick={() => setAmounts((prev) => ({ ...prev, [row.invoiceId]: '0.00' }))}
                            title="Unapply"
                          >
                            clear
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className={`mt-3 rounded-md px-4 py-3 text-sm ${overAllocated ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'}`}>
                Applying {money(sumApplied)} of {money(editedTotal)} ·{' '}
                {overAllocated ? 'over the payment total!' : `${money(remainingUnapplied)} held as credit`}
              </div>

              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={save}
                  disabled={saving || overAllocated}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  onClick={() => { setEditing(false); setError(null); }}
                  disabled={saving}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {!editing && error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  )
}
