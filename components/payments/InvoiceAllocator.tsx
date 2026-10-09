'use client'

import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'

export interface OpenInvoice {
  invoiceId: string
  invoiceNumber: string
  total: number
  balance: number
  paidAmount?: number
  invoiceDate?: string | null
}

export interface Allocation {
  invoiceId: string
  amount: number
}

function r2(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  return { Authorization: `Bearer ${token}` }
}

/**
 * Shared invoice selection + allocation table used by the Check, Credit Card and
 * Other payment flows. Lets the user apply one payment across multiple open
 * invoices, never over an invoice's balance, with select-all, search and totals.
 */
export function InvoiceAllocator(props: {
  invoiceId: string
  paymentAmount?: number
  onChange: (allocations: Allocation[], total: number) => void
  autoSelectCurrent?: boolean
}) {
  const { invoiceId, paymentAmount, onChange, autoSelectCurrent = true } = props
  const [invoices, setInvoices] = useState<OpenInvoice[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [alloc, setAlloc] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/payment-context`, { headers: authHeaders() })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || 'Failed to load open invoices.')
          return
        }
        const list: OpenInvoice[] = data.openInvoices || []
        setInvoices(list)
        setCurrentId(data.currentInvoiceId || null)
        const init: Record<string, string> = {}
        for (const inv of list) {
          init[inv.invoiceId] =
            autoSelectCurrent && inv.invoiceId === data.currentInvoiceId ? r2(inv.balance).toFixed(2) : ''
        }
        setAlloc(init)
      } catch {
        if (!cancelled) setError('Failed to load open invoices.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [invoiceId, autoSelectCurrent])

  const total = useMemo(() => r2(Object.values(alloc).reduce((s, v) => s + (parseFloat(v) || 0), 0)), [alloc])
  const selectedCount = useMemo(() => Object.values(alloc).filter((v) => (parseFloat(v) || 0) > 0).length, [alloc])

  useEffect(() => {
    const allocations: Allocation[] = Object.entries(alloc)
      .map(([invoiceId, v]) => ({ invoiceId, amount: r2(parseFloat(v) || 0) }))
      .filter((a) => a.amount > 0)
    onChange(allocations, total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alloc, total])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return invoices
    return invoices.filter((i) => i.invoiceNumber.toLowerCase().includes(q))
  }, [invoices, search])

  const setAmount = (id: string, v: string) => setAlloc((p) => ({ ...p, [id]: v }))
  const toggle = (inv: OpenInvoice) =>
    setAlloc((p) => ({ ...p, [inv.invoiceId]: (parseFloat(p[inv.invoiceId] || '0') || 0) > 0 ? '' : r2(inv.balance).toFixed(2) }))

  const allSelected = filtered.length > 0 && filtered.every((i) => (parseFloat(alloc[i.invoiceId] || '0') || 0) > 0)
  const selectAll = () =>
    setAlloc((p) => {
      const next = { ...p }
      const target = !allSelected
      for (const i of filtered) next[i.invoiceId] = target ? r2(i.balance).toFixed(2) : ''
      return next
    })

  // Distribute the payment amount oldest-first across open invoices.
  const autoSplit = () => {
    if (!paymentAmount || paymentAmount <= 0) return
    let remaining = r2(paymentAmount)
    const next: Record<string, string> = {}
    for (const inv of invoices) {
      const take = r2(Math.min(remaining, inv.balance))
      next[inv.invoiceId] = take > 0 ? take.toFixed(2) : ''
      remaining = r2(remaining - Math.max(0, take))
    }
    setAlloc(next)
  }

  const over = paymentAmount != null && total > r2(paymentAmount) + 0.005

  if (loading) return <p className="text-sm text-gray-500">Loading open invoices…</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (invoices.length === 0)
    return <p className="text-sm text-gray-500">This customer has no open invoices. The full amount will be held as credit.</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input placeholder="Search invoice #" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" />
        <button type="button" onClick={selectAll} className="whitespace-nowrap rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
        {paymentAmount != null && paymentAmount > 0 && (
          <button type="button" onClick={autoSplit} className="whitespace-nowrap rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
            Auto-split
          </button>
        )}
      </div>

      <div className="max-h-64 overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="py-2 pl-2 pr-1 w-6"></th>
              <th className="py-2 px-2">Invoice</th>
              <th className="py-2 px-2 text-right">Balance</th>
              <th className="py-2 px-2 text-right">Apply</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv) => {
              const selected = (parseFloat(alloc[inv.invoiceId] || '0') || 0) > 0
              return (
                <tr key={inv.invoiceId} className="border-t">
                  <td className="py-1.5 pl-2 pr-1">
                    <input type="checkbox" checked={selected} onChange={() => toggle(inv)} />
                  </td>
                  <td className="py-1.5 px-2">
                    <div className="font-medium text-gray-900">{inv.invoiceNumber}</div>
                    <div className="text-xs text-gray-500">
                      {inv.invoiceDate ? formatDate(inv.invoiceDate) : ''}
                      {inv.paidAmount != null && inv.paidAmount > 0 ? ` · paid ${formatCurrency(inv.paidAmount)}` : ''}
                      {` · total ${formatCurrency(inv.total)}`}
                    </div>
                  </td>
                  <td className="py-1.5 px-2 text-right text-gray-600">{formatCurrency(inv.balance)}</td>
                  <td className="py-1.5 px-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-gray-400">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        max={inv.balance}
                        value={alloc[inv.invoiceId] ?? ''}
                        onChange={(e) => setAmount(inv.invoiceId, e.target.value)}
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-right"
                      />
                      <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setAmount(inv.invoiceId, r2(inv.balance).toFixed(2))}>
                        max
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className={`flex items-center justify-between rounded px-3 py-2 text-sm ${over ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'}`}>
        <span>{selectedCount} invoice{selectedCount === 1 ? '' : 's'} selected</span>
        <span className="font-semibold">
          Applying {formatCurrency(total)}
          {paymentAmount != null ? ` of ${formatCurrency(paymentAmount)}` : ''}
        </span>
      </div>
      {over && <p className="text-xs text-red-600">Applied amount exceeds the payment total.</p>}
    </div>
  )
}
