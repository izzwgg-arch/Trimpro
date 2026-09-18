'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

type GroupLine = {
  paymentId: string
  invoiceId: string
  invoiceNumber: string
  amount: number
  invoiceTotal: number
  invoiceBalance: number
}

type GroupCtx = {
  groupId: string
  tenantName: string
  clientName: string
  methodLabel: string
  reference: string | null
  paidAt: string
  totalAmount: number
  creditAmount: number
  receiptToken: string | null
  receiptUrl: string
  lines: GroupLine[]
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))
}

export default function PaymentGroupPage() {
  const params = useParams()
  const groupId = String(params?.groupId || '')
  const [group, setGroup] = useState<GroupCtx | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const res = await fetch(`/api/payments/group/${encodeURIComponent(groupId)}/receipt?format=json`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to load')
        const data = await res.json()
        if (active) setGroup(data.group)
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load payment group')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [groupId])

  const downloadPdf = async () => {
    setDownloading(true)
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/payments/group/${encodeURIComponent(groupId)}/receipt?format=pdf&download=1`, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('Failed to generate PDF')
      const cd = res.headers.get('content-disposition') || ''
      const match = /filename="?([^";]+)"?/i.exec(cd)
      const filename = match?.[1]?.trim() || `receipt-${groupId.slice(-8)}.pdf`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Failed to download the receipt PDF.')
    } finally {
      setDownloading(false)
    }
  }

  const copyCustomerLink = async () => {
    if (!group?.receiptUrl) return
    try {
      await navigator.clipboard.writeText(group.receiptUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked; ignore */
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading payment…</div>
  if (error || !group) return <div className="p-6 text-sm text-red-600">{error || 'Payment group not found'}</div>

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href="/dashboard/reports/payments" className="text-sm text-gray-500 hover:text-gray-700">
        ← Back to payments
      </Link>

      <div className="mt-3 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payment</div>
          <div className="mt-1 text-3xl font-extrabold text-gray-900">{money(group.totalAmount + (group.creditAmount || 0))}</div>
          <div className="mt-1 text-sm text-gray-600">
            Applied across {group.lines.length} invoice{group.lines.length === 1 ? '' : 's'} · {group.clientName}
          </div>
          {group.creditAmount > 0 && (
            <div className="mt-1 text-sm font-medium text-emerald-700">
              {money(group.totalAmount)} applied · {money(group.creditAmount)} held as account credit
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
          <div>
            <div className="text-gray-500">Date</div>
            <div className="font-medium text-gray-900">{new Date(group.paidAt).toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-gray-500">Method</div>
            <div className="font-medium text-gray-900">{group.methodLabel}</div>
          </div>
          {group.reference && (
            <div>
              <div className="text-gray-500">Reference</div>
              <div className="font-medium text-gray-900">{group.reference}</div>
            </div>
          )}
          <div>
            <div className="text-gray-500">Customer</div>
            <div className="font-medium text-gray-900">{group.clientName}</div>
          </div>
        </div>

        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Invoice</th>
                <th className="py-2 px-4 text-right">Invoice Total</th>
                <th className="py-2 px-4 text-right">Amount Applied</th>
                <th className="py-2 pl-4 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {group.lines.map((l) => (
                <tr key={l.paymentId} className="border-b border-gray-100">
                  <td className="py-2 pr-4">
                    <Link href={`/dashboard/invoices/${l.invoiceId}`} className="font-medium text-blue-600 hover:underline">
                      {l.invoiceNumber}
                    </Link>
                  </td>
                  <td className="py-2 px-4 text-right text-gray-600">{money(l.invoiceTotal)}</td>
                  <td className="py-2 px-4 text-right font-semibold text-gray-900">{money(l.amount)}</td>
                  <td className="py-2 pl-4 text-right text-gray-600">{money(l.invoiceBalance)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-3 pr-4 font-bold text-gray-900">Total Paid</td>
                <td></td>
                <td className="py-3 px-4 text-right font-bold text-gray-900">{money(group.totalAmount)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 p-5">
          <button
            type="button"
            onClick={downloadPdf}
            disabled={downloading}
            className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
          {group.receiptUrl && (
            <button
              type="button"
              onClick={copyCustomerLink}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              {copied ? 'Copied!' : 'Copy customer link'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
