'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

type UiMethod = 'CHECK' | 'QUICK_PAY' | 'OTHER'

type Line = {
  paymentId: string
  invoiceId: string
  invoiceNumber: string
  title: string | null
  dueDate: string | null
  amount: number
  invoiceTotal: number
  invoiceBalance: number
}
type OpenInvoice = {
  invoiceId: string
  invoiceNumber: string
  title: string | null
  dueDate: string | null
  total: number
  balance: number
}
type PaymentView = {
  paymentId: string
  groupId: string | null
  clientId: string
  clientName: string
  method: string
  methodLabel: string
  provider: string | null
  methodEditable: boolean
  customMethod: UiMethod
  customMethodLabel: string
  reference: string | null
  paidAt: string | null
  totalReceived: number
  appliedTotal: number
  unapplied: number
  lines: Line[]
  openInvoices: OpenInvoice[]
}

type Row = {
  invoiceId: string
  invoiceNumber: string
  title: string | null
  dueDate: string | null
  originalAmount: number
  /** Most that can be applied to this invoice by this payment. */
  cap: number
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))
}
function r2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}
function toDateInput(iso: string | null) {
  return iso ? new Date(iso).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
}

export default function PaymentPage() {
  const params = useParams()
  const router = useRouter()
  const paymentId = String(params?.paymentId || '')

  // Last saved state from the server — the form is always populated from it.
  const [pay, setPay] = useState<PaymentView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Editable form state.
  const [received, setReceived] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [method, setMethod] = useState<UiMethod>('CHECK')
  const [methodLabel, setMethodLabel] = useState('')
  const [reference, setReference] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})

  const hydrate = useCallback((v: PaymentView) => {
    setPay(v)
    setReceived(v.totalReceived.toFixed(2))
    setPaidAt(toDateInput(v.paidAt))
    setMethod(v.customMethod)
    setMethodLabel(v.customMethodLabel)
    setReference(v.reference || '')
    const init: Record<string, string> = {}
    for (const l of v.lines) init[l.invoiceId] = l.amount.toFixed(2)
    for (const o of v.openInvoices) init[o.invoiceId] = '0.00'
    setAmounts(init)
  }, [])

  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/payments/${encodeURIComponent(paymentId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to load')
      const data = await res.json()
      hydrate(data.payment)
    } catch (e: any) {
      setError(e?.message || 'Failed to load payment')
    } finally {
      setLoading(false)
    }
  }, [paymentId, hydrate])

  useEffect(() => {
    load()
  }, [load])

  // Applied invoices first, then the customer's other open invoices.
  const rows: Row[] = useMemo(() => {
    if (!pay) return []
    const out: Row[] = pay.lines.map((l) => ({
      invoiceId: l.invoiceId,
      invoiceNumber: l.invoiceNumber,
      title: l.title,
      dueDate: l.dueDate,
      originalAmount: l.invoiceTotal,
      // The invoice balance already excludes this payment, so add it back for the cap.
      cap: r2(l.invoiceBalance + l.amount),
    }))
    for (const o of pay.openInvoices) {
      out.push({
        invoiceId: o.invoiceId,
        invoiceNumber: o.invoiceNumber,
        title: o.title,
        dueDate: o.dueDate,
        originalAmount: o.total,
        cap: o.balance,
      })
    }
    return out
  }, [pay])

  const receivedNum = r2(parseFloat(received) || 0)
  const sumApplied = useMemo(
    () => r2(Object.values(amounts).reduce((s, v) => s + (parseFloat(v) || 0), 0)),
    [amounts]
  )
  const toCredit = r2(receivedNum - sumApplied)
  const overApplied = sumApplied > receivedNum + 0.005
  const overCapRow = rows.find((r) => (parseFloat(amounts[r.invoiceId]) || 0) > r.cap + 0.005)

  const dirty = useMemo(() => {
    if (!pay) return false
    if (receivedNum !== r2(pay.totalReceived)) return true
    if (paidAt !== toDateInput(pay.paidAt)) return true
    if (reference.trim() !== (pay.reference || '').trim()) return true
    if (pay.methodEditable) {
      if (method !== pay.customMethod) return true
      if (method === 'OTHER' && methodLabel.trim() !== pay.customMethodLabel.trim()) return true
    }
    const baseline: Record<string, number> = {}
    for (const l of pay.lines) baseline[l.invoiceId] = l.amount
    return rows.some((r) => r2(parseFloat(amounts[r.invoiceId]) || 0) !== r2(baseline[r.invoiceId] || 0))
  }, [pay, receivedNum, paidAt, reference, method, methodLabel, rows, amounts])

  const setAmount = (invoiceId: string, value: string) => {
    setNotice(null)
    setAmounts((prev) => ({ ...prev, [invoiceId]: value }))
  }

  const toggleRow = (row: Row, checked: boolean) => {
    setNotice(null)
    if (!checked) {
      setAmount(row.invoiceId, '0.00')
      return
    }
    const remaining = r2(receivedNum - sumApplied)
    const amt = Math.min(row.cap, Math.max(0, remaining))
    if (amt <= 0) {
      setNotice('Nothing left to apply. Increase "Amount received" or clear another invoice first.')
      return
    }
    setAmount(row.invoiceId, amt.toFixed(2))
  }

  const autoApply = () => {
    setNotice(null)
    let remaining = receivedNum
    const next: Record<string, string> = {}
    for (const r of rows) {
      const amt = Math.min(r.cap, Math.max(0, remaining))
      next[r.invoiceId] = amt.toFixed(2)
      remaining = r2(remaining - amt)
    }
    setAmounts(next)
  }

  const clearAll = () => {
    setNotice(null)
    const next: Record<string, string> = {}
    for (const r of rows) next[r.invoiceId] = '0.00'
    setAmounts(next)
  }

  const revert = () => {
    if (!pay) return
    setError(null)
    setNotice(null)
    hydrate(pay)
  }

  const save = async () => {
    if (!pay) return
    setError(null)
    setWarning(null)
    setNotice(null)
    if (!(receivedNum > 0)) {
      setError('Please enter an amount received greater than zero.')
      return
    }
    if (overApplied) {
      setError('The amount applied to invoices is more than the amount received.')
      return
    }
    if (overCapRow) {
      setError(`${overCapRow.invoiceNumber}: the payment is more than its open balance.`)
      return
    }
    if (pay.methodEditable && method === 'OTHER' && !methodLabel.trim()) {
      setError('Please enter a payment type name.')
      return
    }
    if (!paidAt) {
      setError('Please enter a payment date.')
      return
    }

    setSaving(true)
    try {
      const token = localStorage.getItem('accessToken')
      const body: Record<string, unknown> = {
        totalReceived: receivedNum,
        paidAt,
        reference: reference.trim(),
        allocations: rows.map((r) => ({
          invoiceId: r.invoiceId,
          amount: r2(parseFloat(amounts[r.invoiceId]) || 0),
        })),
      }
      if (pay.methodEditable) {
        body.method = method
        if (method === 'OTHER') body.methodLabel = methodLabel.trim()
      }
      const res = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to save the payment.')
        return
      }
      if (data.payment) hydrate(data.payment)
      else await load()
      setNotice('Saved.')
      if (data.qboWarning) {
        setWarning(`Saved, but QuickBooks did not update: ${data.qboWarning}. Click Save again to retry.`)
      }
    } catch {
      setError('Failed to save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading payment…</div>
  if (!pay) return <div className="p-6 text-sm text-red-600">{error || 'Payment not found'}</div>

  const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">
        ← Back
      </button>

      <div className="mt-3 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payment</div>
          <div className="mt-1 text-3xl font-extrabold text-gray-900">{money(pay.totalReceived)}</div>
          <div className="mt-1 text-sm text-gray-600">
            <Link href={`/dashboard/clients/${pay.clientId}`} className="font-medium text-blue-600 hover:underline">
              {pay.clientName}
            </Link>{' '}
            · {pay.methodLabel}
          </div>
        </div>

        <div className="p-5">
          {/* Payment details */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Amount received</label>
              <div className="flex items-center gap-1">
                <span className="text-gray-400">$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Payment date</label>
              <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Payment method</label>
              {pay.methodEditable ? (
                <select value={method} onChange={(e) => setMethod(e.target.value as UiMethod)} className={inputCls}>
                  <option value="CHECK">Check</option>
                  <option value="QUICK_PAY">QuickPay</option>
                  <option value="OTHER">Other</option>
                </select>
              ) : (
                <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-600">
                  {pay.methodLabel}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600">Reference no.</label>
              <input
                type="text"
                placeholder="Check #, transaction ID…"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          {pay.methodEditable && method === 'OTHER' && (
            <div className="mt-3 max-w-xs space-y-1">
              <label className="text-xs font-semibold text-gray-600">Payment type name</label>
              <input
                type="text"
                placeholder="e.g. Zelle, Wire…"
                value={methodLabel}
                onChange={(e) => setMethodLabel(e.target.value)}
                className={inputCls}
              />
            </div>
          )}

          {/* Outstanding transactions */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-gray-700">Outstanding transactions</div>
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={autoApply} className="text-blue-600 hover:underline">
                Auto-apply
              </button>
              <button type="button" onClick={clearAll} className="text-gray-500 hover:underline">
                Clear all
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">This customer has no invoices to apply this payment to.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="w-8 py-2 pr-2"></th>
                    <th className="py-2 pr-4">Invoice</th>
                    <th className="py-2 px-3">Due</th>
                    <th className="py-2 px-3 text-right">Original</th>
                    <th className="py-2 px-3 text-right">Open balance</th>
                    <th className="py-2 pl-3 text-right">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const val = amounts[row.invoiceId] ?? '0.00'
                    const checked = (parseFloat(val) || 0) > 0
                    const over = (parseFloat(val) || 0) > row.cap + 0.005
                    return (
                      <tr key={row.invoiceId} className={`border-b border-gray-100 ${checked ? 'bg-blue-50/40' : ''}`}>
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleRow(row, e.target.checked)}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <Link
                            href={`/dashboard/invoices/${row.invoiceId}`}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            {row.invoiceNumber}
                          </Link>
                          {row.title && <div className="max-w-[260px] truncate text-xs text-gray-500">{row.title}</div>}
                        </td>
                        <td className="py-2 px-3 text-gray-600">
                          {row.dueDate ? new Date(row.dueDate).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-600">{money(row.originalAmount)}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{money(row.cap)}</td>
                        <td className="py-2 pl-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-gray-400">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={val}
                              onChange={(e) => setAmount(row.invoiceId, e.target.value)}
                              className={`w-28 rounded border px-2 py-1 text-right text-sm ${
                                over ? 'border-red-400 bg-red-50' : 'border-gray-300'
                              }`}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary */}
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-md bg-gray-50 px-4 py-3 text-sm">
            <div>
              <div className="text-gray-500">Amount received</div>
              <div className="font-semibold text-gray-900">{money(receivedNum)}</div>
            </div>
            <div>
              <div className="text-gray-500">Amount to apply</div>
              <div className={`font-semibold ${overApplied ? 'text-red-700' : 'text-gray-900'}`}>{money(sumApplied)}</div>
            </div>
            <div>
              <div className="text-gray-500">Amount to credit</div>
              <div className={`font-semibold ${toCredit > 0 ? 'text-emerald-700' : 'text-gray-900'}`}>
                {money(Math.max(0, toCredit))}
              </div>
            </div>
          </div>
          {overApplied && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              You're applying {money(sumApplied)} but only {money(receivedNum)} was received.
              <button
                type="button"
                onClick={() => setReceived(sumApplied.toFixed(2))}
                className="font-semibold underline"
              >
                Set amount received to {money(sumApplied)}
              </button>
            </div>
          )}
          {!overApplied && toCredit > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              {money(toCredit)} is not applied to any invoice and is held as the customer's account credit.
            </p>
          )}

          {notice && <p className="mt-2 text-sm text-gray-600">{notice}</p>}
          {warning && <p className="mt-2 text-sm text-amber-700">{warning}</p>}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving || (!dirty && !warning) || overApplied}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={revert}
              disabled={saving || !dirty}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Revert
            </button>
            {!dirty && !saving && <span className="text-xs text-gray-400">No unsaved changes</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
