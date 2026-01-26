'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  User,
  Building2,
  FileText,
  Send,
  Download,
  Edit,
  CheckCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Package,
} from 'lucide-react'
import Link from 'next/link'

interface InvoiceDetail {
  id: string
  invoiceNumber: string
  title: string
  status: string
  subtotal: string
  taxRate: string
  taxAmount: string
  discount: string
  total: string
  balance: string
  paidAmount: string
  invoiceDate: string
  dueDate: string | null
  sentAt: string | null
  paidAt: string | null
  notes: string | null
  terms: string | null
  memo: string | null
  createdAt: string
  updatedAt: string
  client: {
    id: string
    name: string
    companyName: string | null
    contacts: Array<{
      id: string
      firstName: string
      lastName: string
      phone: string | null
      email: string | null
    }>
  } | null
  job: {
    id: string
    jobNumber: string
    title: string
  } | null
  lineItems: Array<{
    id: string
    description: string
    quantity: string
    unitPrice: string
    total: string
    sortOrder: number
    groupId: string | null
    group: {
      id: string
      name: string
      sourceBundleId: string | null
      sourceBundleName: string | null
    } | null
    sourceItemId: string | null
    sourceItem: {
      id: string
      name: string
      kind: string
    } | null
  }>
  payments: Array<{
    id: string
    amount: string
    method: string
    status: string
    processedAt: string | null
    referenceNumber: string | null
  }>
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SENT: 'bg-blue-100 text-blue-800',
  VIEWED: 'bg-purple-100 text-purple-800',
  PARTIAL: 'bg-yellow-100 text-yellow-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
}

export default function InvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const invoiceId = params.id as string
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchInvoice()
  }, [invoiceId])

  const fetchInvoice = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/invoices/${invoiceId}`, {
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
        console.error('Failed to fetch invoice:', error)
        setInvoice(null)
        setLoading(false)
        return
      }

      const data = await response.json()
      if (data.invoice) {
        setInvoice(data.invoice)
      } else {
        setInvoice(null)
      }
    } catch (error) {
      console.error('Failed to fetch invoice:', error)
      setInvoice(null)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading invoice...</p>
        </div>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 text-xl font-semibold mb-2">Invoice not found</div>
        <p className="text-gray-600 mb-4">The invoice you're looking for doesn't exist or you don't have permission to view it.</p>
        <Button variant="outline" onClick={() => router.push('/dashboard/invoices')}>
          ← Back to Invoices
        </Button>
      </div>
    )
  }

  const primaryContact = invoice.client?.contacts?.[0] || null
  const isOverdue = invoice.status === 'OVERDUE' || (invoice.dueDate && new Date(invoice.dueDate) < new Date() && parseFloat(invoice.balance) > 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/dashboard/invoices">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{invoice.title}</h1>
            <p className="mt-1 text-gray-600">
              {invoice.invoiceNumber} • Created {formatDate(invoice.createdAt)}
              {isOverdue && (
                <span className="ml-2 text-red-600 font-semibold flex items-center">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  Overdue
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className={`px-3 py-1 text-sm rounded-full ${statusColors[invoice.status] || 'bg-gray-100 text-gray-800'}`}>
            {invoice.status}
          </span>
          <Button variant="outline">
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button>
            <Send className="mr-2 h-4 w-4" />
            Send
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-4 font-semibold">Description</th>
                      <th className="text-right py-2 px-4 font-semibold">Quantity</th>
                      <th className="text-right py-2 px-4 font-semibold">Unit Price</th>
                      <th className="text-right py-2 px-4 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Group line items by groupId
                      const groupedItems = new Map<string, typeof invoice.lineItems>()
                      const ungroupedItems: typeof invoice.lineItems = []

                      for (const item of invoice.lineItems) {
                        if (item.groupId && item.group) {
                          if (!groupedItems.has(item.groupId)) {
                            groupedItems.set(item.groupId, [])
                          }
                          groupedItems.get(item.groupId)!.push(item)
                        } else {
                          ungroupedItems.push(item)
                        }
                      }

                      const rows: JSX.Element[] = []

                      // Render grouped items
                      for (const [groupId, items] of groupedItems.entries()) {
                        const group = items[0].group!
                        const groupTotal = items.reduce((sum, item) => sum + parseFloat(item.total), 0)
                        const isExpanded = expandedGroups.has(groupId)

                        rows.push(
                          <tr key={`group-${groupId}`} className="border-b bg-gray-50">
                            <td className="py-3 px-4">
                              <button
                                type="button"
                                onClick={() => {
                                  const newExpanded = new Set(expandedGroups)
                                  if (isExpanded) {
                                    newExpanded.delete(groupId)
                                  } else {
                                    newExpanded.add(groupId)
                                  }
                                  setExpandedGroups(newExpanded)
                                }}
                                className="flex items-center space-x-2 hover:text-primary"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                                <Package className="h-4 w-4" />
                                <span className="font-semibold">{group.name}</span>
                                <span className="text-xs text-gray-500">(Bundle)</span>
                              </button>
                            </td>
                            <td className="py-3 px-4 text-right"></td>
                            <td className="py-3 px-4 text-right"></td>
                            <td className="py-3 px-4 text-right font-semibold">
                              {formatCurrency(groupTotal)}
                            </td>
                          </tr>
                        )

                        if (isExpanded) {
                          items.forEach((item) => {
                            rows.push(
                              <tr key={item.id} className="border-b bg-gray-50/50">
                                <td className="py-3 px-4 pl-8">{item.description}</td>
                                <td className="py-3 px-4 text-right">{item.quantity}</td>
                                <td className="py-3 px-4 text-right">{formatCurrency(parseFloat(item.unitPrice))}</td>
                                <td className="py-3 px-4 text-right">
                                  {formatCurrency(parseFloat(item.total))}
                                </td>
                              </tr>
                            )
                          })
                        }
                      }

                      // Render ungrouped items
                      ungroupedItems.forEach((item) => {
                        rows.push(
                          <tr key={item.id} className="border-b">
                            <td className="py-3 px-4">{item.description}</td>
                            <td className="py-3 px-4 text-right">{item.quantity}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(parseFloat(item.unitPrice))}</td>
                            <td className="py-3 px-4 text-right font-semibold">
                              {formatCurrency(parseFloat(item.total))}
                            </td>
                          </tr>
                        )
                      })

                      return rows
                    })()}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Payments */}
          {invoice.payments && invoice.payments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Payments</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {invoice.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <div className="font-semibold">{formatCurrency(parseFloat(payment.amount))}</div>
                        <div className="text-sm text-gray-600">
                          {payment.method} • {payment.status}
                          {payment.processedAt && ` • ${formatDate(payment.processedAt)}`}
                        </div>
                        {payment.referenceNumber && (
                          <div className="text-xs text-gray-500">Ref: {payment.referenceNumber}</div>
                        )}
                      </div>
                      {payment.status === 'COMPLETED' && (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes & Terms */}
          {(invoice.notes || invoice.terms || invoice.memo) && (
            <div className="grid gap-6 md:grid-cols-2">
              {invoice.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle>Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-700 whitespace-pre-wrap">{invoice.notes}</p>
                  </CardContent>
                </Card>
              )}
              {invoice.terms && (
                <Card>
                  <CardHeader>
                    <CardTitle>Terms & Conditions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-700 whitespace-pre-wrap">{invoice.terms}</p>
                  </CardContent>
                </Card>
              )}
              {invoice.memo && (
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>Memo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-700 whitespace-pre-wrap">{invoice.memo}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal:</span>
                <span className="font-semibold">{formatCurrency(parseFloat(invoice.subtotal))}</span>
              </div>
              {parseFloat(invoice.discount) > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Discount:</span>
                  <span>-{formatCurrency(parseFloat(invoice.discount))}</span>
                </div>
              )}
              {parseFloat(invoice.taxRate) > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Tax ({parseFloat(invoice.taxRate) * 100}%):</span>
                  <span>{formatCurrency(parseFloat(invoice.taxAmount))}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold border-t pt-3">
                <span>Total:</span>
                <span>{formatCurrency(parseFloat(invoice.total))}</span>
              </div>
              {parseFloat(invoice.paidAmount) > 0 && (
                <div className="flex justify-between text-green-600 border-t pt-3">
                  <span>Paid:</span>
                  <span>{formatCurrency(parseFloat(invoice.paidAmount))}</span>
                </div>
              )}
              <div className={`flex justify-between text-lg font-bold border-t pt-3 ${parseFloat(invoice.balance) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                <span>Balance:</span>
                <span>{formatCurrency(parseFloat(invoice.balance))}</span>
              </div>
            </CardContent>
          </Card>

          {/* Client Information */}
          {invoice.client && (
            <Card>
              <CardHeader>
                <CardTitle>Client</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Link href={`/dashboard/clients/${invoice.client.id}`} className="text-primary hover:underline">
                    <Building2 className="inline h-4 w-4 mr-2" />
                    {invoice.client.name}
                  </Link>
                  {invoice.client.companyName && (
                    <p className="text-sm text-gray-600 mt-1">{invoice.client.companyName}</p>
                  )}
                </div>
                {primaryContact && (
                  <div className="text-sm text-gray-600">
                    <User className="inline h-4 w-4 mr-2" />
                    {primaryContact.firstName} {primaryContact.lastName}
                    {primaryContact.email && (
                      <p className="mt-1">
                        <FileText className="inline h-3 w-3 mr-1" />
                        {primaryContact.email}
                      </p>
                    )}
                    {primaryContact.phone && (
                      <p>
                        <FileText className="inline h-3 w-3 mr-1" />
                        {primaryContact.phone}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Job Information */}
          {invoice.job && (
            <Card>
              <CardHeader>
                <CardTitle>Job</CardTitle>
              </CardHeader>
              <CardContent>
                <Link href={`/dashboard/jobs/${invoice.job.id}`} className="text-primary hover:underline">
                  {invoice.job.jobNumber} - {invoice.job.title}
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Invoice Date:</span>
                <span>{formatDate(invoice.invoiceDate)}</span>
              </div>
              {invoice.dueDate && (
                <div className={`flex justify-between ${isOverdue ? 'text-red-600 font-semibold' : ''}`}>
                  <span className="text-gray-600">Due Date:</span>
                  <span>{formatDate(invoice.dueDate)}</span>
                </div>
              )}
              {invoice.sentAt && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Sent:</span>
                  <span>{formatDate(invoice.sentAt)}</span>
                </div>
              )}
              {invoice.paidAt && (
                <div className="flex justify-between text-green-600">
                  <span>Paid:</span>
                  <span>{formatDate(invoice.paidAt)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Created:</span>
                <span>{formatDate(invoice.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Last Updated:</span>
                <span>{formatDate(invoice.updatedAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
