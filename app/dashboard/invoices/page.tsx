'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, Filter, DollarSign, Calendar, AlertCircle, Trash2, Copy } from 'lucide-react'
import Link from 'next/link'

interface Invoice {
  id: string
  invoiceNumber: string
  title: string
  status: string
  total: string
  balance: string
  paidAmount: string
  invoiceDate: string
  dueDate: string | null
  sentAt: string | null
  paidAt: string | null
  client: {
    id: string
    name: string
    companyName: string | null
  }
  job: {
    id: string
    jobNumber: string
  } | null
  _count: {
    lineItems: number
    payments: number
  }
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SENT: 'bg-blue-100 text-blue-800',
  VIEWED: 'bg-purple-100 text-purple-800',
  PARTIAL: 'bg-yellow-100 text-yellow-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
  REFUNDED: 'bg-orange-100 text-orange-800',
}

export default function InvoicesPage() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    fetchInvoices()
  }, [search, status])

  const fetchInvoices = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const params = new URLSearchParams({
        search,
        status,
        page: '1',
        limit: '50',
      })

      const response = await fetch(`/api/invoices?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      const data = await response.json()
      setInvoices(data.invoices || [])
    } catch (error) {
      console.error('Failed to fetch invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (invoiceId: string, invoiceTitle: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete invoice "${invoiceTitle}"?\n\n` +
      'If the invoice has payments, it cannot be deleted and will be cancelled instead. This action cannot be undone.'
    )

    if (!confirmed) return

    setDeletingId(invoiceId)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to delete invoice')
        setDeletingId(null)
        return
      }

      // Refresh the invoices list
      fetchInvoices()
    } catch (error) {
      console.error('Error deleting invoice:', error)
      alert('Failed to delete invoice')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDuplicateSelected = async () => {
    if (selectedIds.length === 0) return
    if (!confirm(`Duplicate ${selectedIds.length} selected invoice(s)?`)) return

    setDuplicating(true)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      for (const invoiceId of selectedIds) {
        const response = await fetch(`/api/invoices/${invoiceId}/duplicate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          alert(data.error || 'Failed to duplicate one or more invoices')
          break
        }
      }

      setSelectedIds([])
      fetchInvoices()
    } catch (error) {
      console.error('Failed duplicating invoices:', error)
      alert('Failed to duplicate selected invoices')
    } finally {
      setDuplicating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading invoices...</p>
        </div>
      </div>
    )
  }

  const totalUnpaid = invoices
    .filter((inv) => inv.status !== 'PAID' && inv.status !== 'CANCELLED')
    .reduce((sum, inv) => sum + parseFloat(inv.balance), 0)

  const overdueCount = invoices.filter((inv) => inv.status === 'OVERDUE').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Invoices</h1>
          <p className="mt-2 text-gray-600">Manage invoices and payments</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => router.push('/dashboard/invoices/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Invoice
          </Button>
          <Button
            variant="outline"
            onClick={handleDuplicateSelected}
            disabled={selectedIds.length === 0 || duplicating}
          >
            <Copy className="mr-2 h-4 w-4" />
            {duplicating ? 'Duplicating...' : `Duplicate${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Unpaid</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalUnpaid)}</div>
            <p className="text-xs text-gray-500 mt-1">
              {invoices.filter((inv) => inv.status !== 'PAID' && inv.status !== 'CANCELLED').length} invoices
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Overdue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{overdueCount}</div>
            <p className="text-xs text-gray-500 mt-1">Requires attention</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invoices.length}</div>
            <p className="text-xs text-gray-500 mt-1">All time</p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search invoices by number or title..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Status</option>
                <option value="DRAFT">Draft</option>
                <option value="SENT">Sent</option>
                <option value="VIEWED">Viewed</option>
                <option value="PARTIAL">Partial</option>
                <option value="PAID">Paid</option>
                <option value="OVERDUE">Overdue</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invoices List */}
      <div className="space-y-4">
        {invoices.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <DollarSign className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No invoices</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by creating a new invoice.
              </p>
              <div className="mt-6">
                <Button onClick={() => router.push('/dashboard/invoices/new')}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Invoice
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          invoices.map((invoice) => {
            const isOverdue = invoice.status === 'OVERDUE' || (invoice.dueDate && new Date(invoice.dueDate) < new Date() && Number(invoice.balance) > 0)
            return (
              <Card key={invoice.id} className={`hover:shadow-lg transition-shadow ${isOverdue ? 'border-red-300' : ''}`}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <Link href={`/dashboard/invoices/${invoice.id}`}>
                        <CardTitle className="text-lg hover:text-primary cursor-pointer">
                          {invoice.title}
                        </CardTitle>
                      </Link>
                      <CardDescription className="mt-1">
                        {invoice.invoiceNumber} • <Link href={`/dashboard/clients/${invoice.client.id}`} className="hover:text-primary">{invoice.client.name}</Link>
                        {invoice.job && ` • Job ${invoice.job.jobNumber}`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(invoice.id)}
                        onChange={(e) =>
                          setSelectedIds((prev) =>
                            e.target.checked
                              ? [...prev, invoice.id]
                              : prev.filter((id) => id !== invoice.id)
                          )
                        }
                        className="h-4 w-4"
                        title="Select for duplicate"
                      />
                      {isOverdue && (
                        <AlertCircle className="h-5 w-5 text-red-500" />
                      )}
                      <span className={`px-2 py-1 text-xs rounded-full ${statusColors[invoice.status] || 'bg-gray-100 text-gray-800'}`}>
                        {invoice.status}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Total</span>
                      <span className="text-lg font-bold">{formatCurrency(parseFloat(invoice.total))}</span>
                    </div>
                    
                    {parseFloat(invoice.balance) > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-500">Balance</span>
                        <span className={`text-lg font-semibold ${isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
                          {formatCurrency(parseFloat(invoice.balance))}
                        </span>
                      </div>
                    )}

                    {parseFloat(invoice.paidAmount) > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-500">Paid</span>
                        <span className="text-sm font-medium text-green-600">
                          {formatCurrency(parseFloat(invoice.paidAmount))}
                        </span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 text-sm pt-2 border-t">
                      <div>
                        <p className="text-xs text-gray-500">Invoice Date</p>
                        <p className="font-medium text-gray-700">{formatDate(invoice.invoiceDate)}</p>
                      </div>
                      {invoice.dueDate && (
                        <div>
                          <p className={`text-xs ${isOverdue ? 'text-red-500' : 'text-gray-500'}`}>
                            Due Date {isOverdue && '• OVERDUE'}
                          </p>
                          <p className={`font-medium ${isOverdue ? 'text-red-600' : 'text-gray-700'}`}>
                            {formatDate(invoice.dueDate)}
                          </p>
                        </div>
                      )}
                    </div>

                    {invoice._count.payments > 0 && (
                      <div className="pt-2 border-t">
                        <p className="text-xs text-gray-500">
                          {invoice._count.payments} payment{invoice._count.payments !== 1 ? 's' : ''}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex items-center space-x-3 text-xs text-gray-500">
                        {invoice._count.lineItems > 0 && (
                          <span>{invoice._count.lineItems} line item{invoice._count.lineItems !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(invoice.id, invoice.title)
                        }}
                        disabled={deletingId === invoice.id}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
