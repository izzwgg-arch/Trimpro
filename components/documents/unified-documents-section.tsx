'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency, formatDate } from '@/lib/utils'
import { DollarSign, FileText, Search, ChevronDown, ChevronRight, Download, Mail, X } from 'lucide-react'
import type { UnifiedDocumentKind, UnifiedDocumentRow } from '@/lib/documents/unified-documents'

type TypeFilter = 'all' | UnifiedDocumentKind
type InvoiceFilter = 'all' | 'paid' | 'unpaid'
type EstimateFilter = 'all' | 'open' | 'converted'
type SortOption = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'

function matchesEstimateFilter(status: string, filter: EstimateFilter) {
  if (filter === 'all') return true
  if (filter === 'converted') return status === 'CONVERTED'
  return !['CONVERTED', 'REJECTED', 'EXPIRED'].includes(status)
}

const kindLabels: Record<UnifiedDocumentKind, string> = {
  estimate: 'Estimate',
  invoice: 'Invoice',
  payment: 'Payment',
}

const kindBadgeClass: Record<UnifiedDocumentKind, string> = {
  estimate: 'bg-indigo-100 text-indigo-800',
  invoice: 'bg-slate-100 text-slate-800',
  payment: 'bg-emerald-100 text-emerald-800',
}

function statusClass(kind: UnifiedDocumentKind, status: string) {
  if (kind === 'estimate') {
    if (status === 'ACCEPTED' || status === 'CONVERTED') return 'bg-green-100 text-green-800'
    if (status === 'SENT') return 'bg-blue-100 text-blue-800'
    if (status === 'REJECTED') return 'bg-red-100 text-red-800'
    return 'bg-gray-100 text-gray-700'
  }
  if (kind === 'invoice') {
    if (status === 'PAID') return 'bg-green-100 text-green-800'
    if (status === 'OVERDUE') return 'bg-red-100 text-red-800'
    if (status === 'PARTIAL') return 'bg-amber-100 text-amber-800'
    return 'bg-gray-100 text-gray-800'
  }
  if (status === 'COMPLETED') return 'bg-green-100 text-green-800'
  if (status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED') return 'bg-orange-100 text-orange-800'
  return 'bg-gray-100 text-gray-800'
}

interface UnifiedDocumentsSectionProps {
  documents: UnifiedDocumentRow[]
  loading?: boolean
  error?: string | null
  description?: string
  enableInvoiceSelection?: boolean
  selectedInvoiceIds?: string[]
  onToggleInvoice?: (invoiceId: string, checked: boolean) => void
  onAddPayment?: () => void
  defaultOpen?: boolean
  defaultReceiptEmail?: string | null
  onDocumentsRefresh?: () => void | Promise<void>
}

export function UnifiedDocumentsSection({
  documents,
  loading = false,
  error = null,
  description = 'Estimates, invoices, and payments in one place',
  enableInvoiceSelection = false,
  selectedInvoiceIds = [],
  onToggleInvoice,
  onAddPayment,
  defaultOpen = true,
  defaultReceiptEmail = null,
  onDocumentsRefresh,
}: UnifiedDocumentsSectionProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(defaultOpen)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>('all')
  const [estimateFilter, setEstimateFilter] = useState<EstimateFilter>('all')
  const [sort, setSort] = useState<SortOption>('date-desc')
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null)
  const [showReceiptEmailDialog, setShowReceiptEmailDialog] = useState(false)
  const [receiptEmailPayment, setReceiptEmailPayment] = useState<UnifiedDocumentRow | null>(null)
  const [receiptEmailTo, setReceiptEmailTo] = useState('')
  const [receiptEmailSending, setReceiptEmailSending] = useState(false)
  const [receiptEmailResult, setReceiptEmailResult] = useState<{ ok: boolean; message: string } | null>(null)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()

    let rows = documents.filter((row) => {
      if (typeFilter !== 'all' && row.kind !== typeFilter) return false
      if (row.kind === 'invoice' && typeFilter === 'invoice') {
        if (invoiceFilter === 'paid' && !row.isPaid) return false
        if (invoiceFilter === 'unpaid' && row.isPaid) return false
      }
      if (row.kind === 'estimate' && typeFilter === 'estimate') {
        if (!matchesEstimateFilter(row.status, estimateFilter)) return false
      }
      if (!query) return true
      const haystack = [row.number, row.title, row.status, row.meta, row.clientName, kindLabels[row.kind]]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })

    rows = [...rows].sort((a, b) => {
      switch (sort) {
        case 'date-asc':
          return new Date(a.date).getTime() - new Date(b.date).getTime()
        case 'amount-desc':
          return b.amount - a.amount
        case 'amount-asc':
          return a.amount - b.amount
        default:
          return new Date(b.date).getTime() - new Date(a.date).getTime()
      }
    })

    return rows
  }, [documents, search, typeFilter, invoiceFilter, estimateFilter, sort])

  const visibleTotal = filtered.reduce((sum, row) => sum + row.amount, 0)

  const showInvoiceFilter = typeFilter === 'invoice'
  const showEstimateFilter = typeFilter === 'estimate'
  const filterCount = 1 + (showEstimateFilter ? 1 : 0) + (showInvoiceFilter ? 1 : 0) + 1
  const showReceiptActions = documents.some((row) => row.kind === 'payment' && row.canReceipt)
  const leadingColumns = (enableInvoiceSelection ? 1 : 0) + 6
  const totalColumns = leadingColumns + (showReceiptActions ? 1 : 0)

  const downloadPaymentReceipt = async (row: UnifiedDocumentRow) => {
    setDownloadingReceiptId(row.id)
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/payments/${row.id}/receipt`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const contentType = response.headers.get('content-type') || ''
        const data = contentType.includes('application/json')
          ? await response.json().catch(() => ({}))
          : {}
        alert(
          data.error ||
            (response.status === 403
              ? 'You do not have permission to download receipts.'
              : `Failed to download receipt (${response.status})`)
        )
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `receipt-${row.number || row.id}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Receipt download error:', error)
      alert('Failed to download receipt')
    } finally {
      setDownloadingReceiptId(null)
    }
  }

  const openReceiptEmailDialog = (row: UnifiedDocumentRow) => {
    setReceiptEmailPayment(row)
    setReceiptEmailTo(defaultReceiptEmail || '')
    setReceiptEmailResult(null)
    setShowReceiptEmailDialog(true)
  }

  const sendReceiptEmail = async () => {
    if (!receiptEmailPayment || !receiptEmailTo.trim()) return
    setReceiptEmailSending(true)
    setReceiptEmailResult(null)
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/payments/${receiptEmailPayment.id}/receipt`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: receiptEmailTo.trim() }),
      })
      const data = await response.json()
      if (!response.ok) {
        setReceiptEmailResult({ ok: false, message: data.error || 'Failed to send receipt' })
        return
      }
      setReceiptEmailResult({ ok: true, message: `Receipt sent to ${data.sentTo}` })
      await onDocumentsRefresh?.()
      setTimeout(() => {
        setShowReceiptEmailDialog(false)
        setReceiptEmailPayment(null)
      }, 2000)
    } catch {
      setReceiptEmailResult({ ok: false, message: 'Network error — please try again' })
    } finally {
      setReceiptEmailSending(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documents
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {open && enableInvoiceSelection && onAddPayment && (
              <Button variant="outline" onClick={onAddPayment} disabled={selectedInvoiceIds.length === 0}>
                <DollarSign className="mr-2 h-4 w-4" />
                Add Payment{selectedInvoiceIds.length > 0 ? ` (${selectedInvoiceIds.length})` : ''}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setOpen((prev) => !prev)}
              aria-label={open ? 'Hide documents' : 'Show documents'}
              aria-expanded={open}
            >
              {open ? (
                <ChevronDown className="h-5 w-5 text-gray-500" />
              ) : (
                <ChevronRight className="h-5 w-5 text-gray-500" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      {open && (
      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number, title, status..."
              className="pl-9"
            />
          </div>
          <div
            className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${
              filterCount >= 4 ? 'lg:grid-cols-4' : filterCount === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
            } lg:flex-1 lg:max-w-3xl`}
          >
            <Select value={typeFilter} onValueChange={(v) => {
              const next = v as TypeFilter
              setTypeFilter(next)
              if (next !== 'invoice') setInvoiceFilter('all')
              if (next !== 'estimate') setEstimateFilter('all')
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="estimate">Estimates</SelectItem>
                <SelectItem value="invoice">Invoices</SelectItem>
                <SelectItem value="payment">Payments</SelectItem>
              </SelectContent>
            </Select>
            {showEstimateFilter && (
              <Select value={estimateFilter} onValueChange={(v) => setEstimateFilter(v as EstimateFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Estimate status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All estimates</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                </SelectContent>
              </Select>
            )}
            {showInvoiceFilter && (
              <Select value={invoiceFilter} onValueChange={(v) => setInvoiceFilter(v as InvoiceFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Invoice status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All invoices</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
              <SelectTrigger>
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date-desc">Newest first</SelectItem>
                <SelectItem value="date-asc">Oldest first</SelectItem>
                <SelectItem value="amount-desc">Amount high → low</SelectItem>
                <SelectItem value="amount-asc">Amount low → high</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-gray-500">Loading documents...</p>
        ) : error ? (
          <p className="py-4 text-sm text-red-600">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No documents match your filters</p>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[min(32rem,65vh)] rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 shadow-[0_1px_0_0_rgb(229_231_235)]">
                <tr>
                  {enableInvoiceSelection && <th className="px-3 py-2 w-8" />}
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Status</th>
                  {showReceiptActions && <th className="px-3 py-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const selectable =
                    enableInvoiceSelection &&
                    row.kind === 'invoice' &&
                    row.isPaid === false &&
                    (row.balance ?? 0) > 0

                  return (
                    <tr key={`${row.kind}-${row.id}`} className="border-t hover:bg-gray-50">
                      {enableInvoiceSelection && (
                        <td className="px-3 py-2 align-top">
                          {selectable ? (
                            <input
                              type="checkbox"
                              checked={selectedInvoiceIds.includes(row.id)}
                              onChange={(e) => onToggleInvoice?.(row.id, e.target.checked)}
                              className="mt-1"
                            />
                          ) : null}
                        </td>
                      )}
                      <td className="px-3 py-2 align-top">
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${kindBadgeClass[row.kind]}`}>
                          {kindLabels[row.kind]}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {row.href !== '#' ? (
                          <Link href={row.href} className="font-medium text-primary hover:underline">
                            {row.number}
                          </Link>
                        ) : (
                          <span className="font-medium">{row.number}</span>
                        )}
                        {row.meta && (
                          <p className="text-xs text-gray-500 mt-0.5">{row.meta}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top max-w-[16rem] text-gray-600">
                        <p className="truncate">{row.title || '—'}</p>
                        {row.clientName && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">Sub-client: {row.clientName}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-gray-600">
                        {formatDate(row.date)}
                      </td>
                      <td className="px-3 py-2 align-top text-right font-medium whitespace-nowrap">
                        {formatCurrency(row.amount)}
                        {row.kind === 'invoice' && row.balance != null && row.balance > 0 && (
                          <p className="text-xs font-normal text-amber-700">
                            Bal {formatCurrency(row.balance)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs ${statusClass(row.kind, row.status)}`}>
                          {row.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      {showReceiptActions && (
                        <td className="px-3 py-2 align-top">
                          {row.kind === 'payment' && row.canReceipt ? (
                            <div className="flex flex-col items-start gap-1">
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  disabled={downloadingReceiptId === row.id}
                                  onClick={() => downloadPaymentReceipt(row)}
                                >
                                  <Download className="mr-1 h-3 w-3" />
                                  {downloadingReceiptId === row.id ? '...' : 'PDF'}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => openReceiptEmailDialog(row)}
                                >
                                  <Mail className="mr-1 h-3 w-3" />
                                  Email
                                </Button>
                              </div>
                              {row.receiptEmailSentAt && (
                                <span className="text-[10px] text-gray-400">Receipt emailed</span>
                              )}
                            </div>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-10 border-t bg-slate-50 shadow-[0_-1px_0_0_rgb(229_231_235)]">
                <tr>
                  <td
                    colSpan={totalColumns - 2}
                    className="px-3 py-3 text-sm text-gray-600"
                  >
                    Showing {filtered.length} of {documents.length} document{documents.length !== 1 ? 's' : ''}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-semibold text-gray-900">
                    {formatCurrency(visibleTotal)}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">Total shown</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
      )}

      {showReceiptEmailDialog && receiptEmailPayment && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Email Payment Receipt</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {formatCurrency(receiptEmailPayment.amount)} — Invoice {receiptEmailPayment.number}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowReceiptEmailDialog(false)
                  setReceiptEmailPayment(null)
                  setReceiptEmailResult(null)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Send To</label>
                <input
                  type="email"
                  value={receiptEmailTo}
                  onChange={(e) => setReceiptEmailTo(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e4d6e] focus:border-transparent"
                  onKeyDown={(e) => { if (e.key === 'Enter') sendReceiptEmail() }}
                  autoFocus
                />
                {defaultReceiptEmail && receiptEmailTo !== defaultReceiptEmail && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-blue-600 hover:underline"
                    onClick={() => setReceiptEmailTo(defaultReceiptEmail)}
                  >
                    Use {defaultReceiptEmail}
                  </button>
                )}
              </div>
              {receiptEmailResult && (
                <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
                  receiptEmailResult.ok
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {receiptEmailResult.message}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-5 pt-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowReceiptEmailDialog(false)
                  setReceiptEmailPayment(null)
                  setReceiptEmailResult(null)
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-[#1e4d6e] hover:bg-[#163a54] text-white"
                onClick={sendReceiptEmail}
                disabled={receiptEmailSending || !receiptEmailTo.trim()}
              >
                <Mail className="h-4 w-4 mr-1" />
                {receiptEmailSending ? 'Sending...' : 'Send Receipt'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
