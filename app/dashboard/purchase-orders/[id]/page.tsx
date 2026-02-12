'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ShoppingCart,
  Calendar,
  DollarSign,
  Building2,
  FileText,
  CheckCircle,
  XCircle,
  Send,
  Download,
  Edit,
  Package,
  AlertCircle,
  Trash2,
  Mail,
  Phone,
  Briefcase,
  Printer,
  Copy,
} from 'lucide-react'
import Link from 'next/link'

interface PurchaseOrderDetail {
  id: string
  poNumber: string
  vendor: string
  vendorId: string | null
  vendorRef: {
    id: string
    name: string
    email: string | null
    phone: string | null
    address: string | null
    city: string | null
    state: string | null
    zipCode: string | null
    contactPerson: string | null
  } | null
  status: string
  total: number
  orderDate: string | null
  expectedDate: string | null
  receivedDate: string | null
  job: {
    id: string
    jobNumber: string
    title: string
    client: {
      id: string
      name: string
    }
  } | null
  lineItems: Array<{
    id: string
    description: string
    quantity: number
    unitPrice: number
    total: number
  }>
  activities: Array<{
    id: string
    type: string
    description: string
    createdAt: string
    user: {
      firstName: string
      lastName: string
    }
  }>
  subtotal: number
  tax?: number
  shipping?: number
  balance: number
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  ORDERED: 'bg-purple-100 text-purple-800',
  RECEIVED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  ORDERED: 'Ordered',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
}

export default function PurchaseOrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)

  useEffect(() => {
    fetchPurchaseOrder()
  }, [params.id])

  const fetchPurchaseOrder = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/purchase-orders/${params.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        if (response.status === 404) {
          router.push('/dashboard/purchase-orders')
          return
        }
        throw new Error('Failed to fetch purchase order')
      }

      const data = await response.json()
      setPo(data.purchaseOrder)
    } catch (error) {
      console.error('Error fetching purchase order:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/purchase-orders/${params.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.ok) {
        fetchPurchaseOrder()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to approve purchase order')
      }
    } catch (error) {
      console.error('Error approving purchase order:', error)
      alert('Failed to approve purchase order')
    }
  }

  const handleSend = async () => {
    if (!po?.vendorRef?.email) {
      alert('Vendor email is required to send purchase order')
      return
    }

    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/purchase-orders/${params.id}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: po.vendorRef.email,
        }),
      })

      if (response.ok) {
        alert('Purchase order sent successfully')
        fetchPurchaseOrder()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to send purchase order')
      }
    } catch (error) {
      console.error('Error sending purchase order:', error)
      alert('Failed to send purchase order')
    }
  }

  const handleReceive = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/purchase-orders/${params.id}/receive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.ok) {
        alert('Purchase order marked as received')
        fetchPurchaseOrder()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to mark purchase order as received')
      }
    } catch (error) {
      console.error('Error marking purchase order as received:', error)
      alert('Failed to mark purchase order as received')
    }
  }

  const handleDelete = async () => {
    if (!po) return

    const confirmed = window.confirm(
      `Are you sure you want to delete purchase order "${po.poNumber}"?\n\n` +
      'This action cannot be undone.'
    )

    if (!confirmed) return

    setDeleting(true)
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/purchase-orders/${params.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.ok) {
        router.push('/dashboard/purchase-orders')
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to delete purchase order')
        setDeleting(false)
      }
    } catch (error) {
      console.error('Error deleting purchase order:', error)
      alert('Failed to delete purchase order')
      setDeleting(false)
    }
  }

  const fetchPdfHtml = async (print = false) => {
    const token = localStorage.getItem('accessToken')
    if (!token) {
      router.push('/auth/login')
      throw new Error('Not authenticated')
    }

    const response = await fetch(`/api/purchase-orders/${params.id}/pdf${print ? '?print=1' : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (response.status === 401) {
      router.push('/auth/login')
      throw new Error('Unauthorized')
    }
    if (!response.ok) {
      throw new Error('Failed to generate PDF')
    }

    return response.text()
  }

  const handleDownloadPDF = async () => {
    try {
      const html = await fetchPdfHtml(false)
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `PO-${po?.poNumber || params.id}.html`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download purchase order PDF error:', error)
      alert('Failed to download purchase order PDF')
    }
  }

  const handlePrint = async () => {
    try {
      const html = await fetchPdfHtml(true)
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        alert('Popup blocked. Please allow popups to print.')
        return
      }
      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()
    } catch (error) {
      console.error('Print purchase order PDF error:', error)
      alert('Failed to print purchase order')
    }
  }

  const handleDuplicate = async () => {
    setDuplicating(true)
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/purchase-orders/${params.id}/duplicate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(data.error || 'Failed to duplicate purchase order')
        return
      }

      if (data?.id) {
        router.push(`/dashboard/purchase-orders/${data.id}`)
      } else {
        router.push('/dashboard/purchase-orders')
      }
    } catch (error) {
      console.error('Error duplicating purchase order:', error)
      alert('Failed to duplicate purchase order')
    } finally {
      setDuplicating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading purchase order...</p>
        </div>
      </div>
    )
  }

  if (!po) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
        <h3 className="mt-2 text-sm font-medium text-gray-900">Purchase order not found</h3>
        <p className="mt-1 text-sm text-gray-500">The purchase order you're looking for doesn't exist.</p>
        <div className="mt-6">
          <Button onClick={() => router.push('/dashboard/purchase-orders')}>Back to Purchase Orders</Button>
        </div>
      </div>
    )
  }

  const canEdit = ['DRAFT', 'PENDING_APPROVAL'].includes(po.status)
  const canApprove = po.status === 'PENDING_APPROVAL' || po.status === 'DRAFT'
  const canSend = ['APPROVED', 'DRAFT'].includes(po.status)
  const canReceive = po.status === 'ORDERED'
  const canCancel = !['RECEIVED', 'CANCELLED'].includes(po.status)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-3xl font-bold text-gray-900">{po.poNumber}</h1>
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusColors[po.status] || 'bg-gray-100 text-gray-800'}`}>
              {statusLabels[po.status] || po.status}
            </span>
          </div>
          <p className="mt-2 text-gray-600">
            Vendor: {po.vendorRef?.name || po.vendor}
            {po.job && ` • Job: ${po.job.jobNumber}`}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {canEdit && (
            <Link href={`/dashboard/purchase-orders/${po.id}/edit`}>
              <Button variant="outline">
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </Link>
          )}
          {canApprove && (
            <Button onClick={handleApprove} variant="outline">
              <CheckCircle className="mr-2 h-4 w-4" />
              Approve
            </Button>
          )}
          {canSend && po.vendorRef?.email && (
            <Button onClick={handleSend} variant="outline">
              <Send className="mr-2 h-4 w-4" />
              Send to Vendor
            </Button>
          )}
          {canReceive && (
            <Button onClick={handleReceive} variant="outline">
              <Package className="mr-2 h-4 w-4" />
              Mark as Received
            </Button>
          )}
          <Button onClick={handleDownloadPDF} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
          <Button onClick={handlePrint} variant="outline">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button onClick={handleDuplicate} variant="outline" disabled={duplicating}>
            <Copy className="mr-2 h-4 w-4" />
            {duplicating ? 'Duplicating...' : 'Duplicate'}
          </Button>
          {canCancel && (
            <Button onClick={handleDelete} variant="destructive" disabled={deleting}>
              <Trash2 className="mr-2 h-4 w-4" />
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Vendor Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Building2 className="mr-2 h-5 w-5" />
                Vendor Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              {po.vendorRef ? (
                <div className="space-y-2">
                  <div>
                    <strong>{po.vendorRef.name}</strong>
                    {po.vendorRef.contactPerson && (
                      <p className="text-sm text-gray-600">Contact: {po.vendorRef.contactPerson}</p>
                    )}
                  </div>
                  {po.vendorRef.email && (
                    <p className="text-sm text-gray-600">
                      <Mail className="inline mr-1 h-4 w-4" />
                      {po.vendorRef.email}
                    </p>
                  )}
                  {po.vendorRef.phone && (
                    <p className="text-sm text-gray-600">
                      <Phone className="inline mr-1 h-4 w-4" />
                      {po.vendorRef.phone}
                    </p>
                  )}
                  {(po.vendorRef.address || po.vendorRef.city) && (
                    <p className="text-sm text-gray-600">
                      {[po.vendorRef.address, po.vendorRef.city, po.vendorRef.state, po.vendorRef.zipCode]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-gray-600">{po.vendor}</p>
              )}
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <FileText className="mr-2 h-5 w-5" />
                Line Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Description</th>
                      <th className="text-right py-2 px-3">Quantity</th>
                      <th className="text-right py-2 px-3">Unit Price</th>
                      <th className="text-right py-2 px-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.lineItems.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="py-2 px-3">{item.description}</td>
                        <td className="text-right py-2 px-3">{item.quantity}</td>
                        <td className="text-right py-2 px-3">{formatCurrency(item.unitPrice)}</td>
                        <td className="text-right py-2 px-3 font-medium">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Activity Log */}
          {po.activities && po.activities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Activity Log</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {po.activities.map((activity) => (
                    <div key={activity.id} className="flex items-start space-x-3 pb-3 border-b last:border-0">
                      <div className="flex-1">
                        <p className="text-sm font-medium">{activity.description}</p>
                        <p className="text-xs text-gray-500">
                          {activity.user.firstName} {activity.user.lastName} • {formatDate(activity.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
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
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium">{formatCurrency(po.subtotal)}</span>
              </div>
              {po.tax && po.tax > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Tax</span>
                  <span className="font-medium">{formatCurrency(po.tax)}</span>
                </div>
              )}
              {po.shipping && po.shipping > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Shipping</span>
                  <span className="font-medium">{formatCurrency(po.shipping)}</span>
                </div>
              )}
              <div className="flex justify-between pt-3 border-t">
                <span className="font-bold">Total</span>
                <span className="text-xl font-bold">{formatCurrency(po.total)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Dates */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Calendar className="mr-2 h-5 w-5" />
                Dates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {po.orderDate && (
                <div>
                  <p className="text-sm text-gray-600">Order Date</p>
                  <p className="font-medium">{formatDate(po.orderDate)}</p>
                </div>
              )}
              {po.expectedDate && (
                <div>
                  <p className="text-sm text-gray-600">Expected Delivery</p>
                  <p className="font-medium">{formatDate(po.expectedDate)}</p>
                </div>
              )}
              {po.receivedDate && (
                <div>
                  <p className="text-sm text-gray-600">Received Date</p>
                  <p className="font-medium">{formatDate(po.receivedDate)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Linked Job */}
          {po.job && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Briefcase className="mr-2 h-5 w-5" />
                  Linked Job
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Link href={`/dashboard/jobs/${po.job.id}`} className="text-primary hover:underline">
                  {po.job.jobNumber} - {po.job.title}
                </Link>
                <p className="text-sm text-gray-600 mt-1">Client: {po.job.client.name}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
