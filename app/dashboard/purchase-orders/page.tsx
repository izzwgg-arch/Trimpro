'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, Filter, FileText, Package, TrendingUp } from 'lucide-react'
import Link from 'next/link'

interface PurchaseOrder {
  id: string
  poNumber: string
  status: string
  expectedDate: string | null
  orderDate: string | null
  vendor: string
  vendorId: string | null
  vendorRef: {
    id: string
    name: string
    email: string | null
  } | null
  job: {
    id: string
    jobNumber: string
    title: string
  } | null
  subtotal: number
  tax?: number
  shipping?: number
  total: number
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  ORDERED: 'bg-purple-100 text-purple-800',
  RECEIVED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

export default function PurchaseOrdersPage() {
  const router = useRouter()
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')

  useEffect(() => {
    fetchPurchaseOrders()
  }, [search, status])

  const fetchPurchaseOrders = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const params = new URLSearchParams({
        search,
        status,
        page: '1',
        limit: '50',
      })

      const response = await fetch(`/api/purchase-orders?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      const data = await response.json()
      setPurchaseOrders(data.purchaseOrders || [])
    } catch (error) {
      console.error('Failed to fetch purchase orders:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading purchase orders...</p>
        </div>
      </div>
    )
  }

  const totalValue = purchaseOrders.reduce((sum, po) => sum + po.total, 0)
  const openPOs = purchaseOrders.filter((po) => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED'].includes(po.status))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="mt-2 text-gray-600">Manage vendor purchase orders and costs</p>
        </div>
        <Button onClick={() => router.push('/dashboard/purchase-orders/new')}>
          <Plus className="mr-2 h-4 w-4" />
          New PO
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Open POs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{openPOs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total POs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{purchaseOrders.length}</div>
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
                placeholder="Search by PO number or title..."
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
                <option value="PENDING_APPROVAL">Pending Approval</option>
                <option value="APPROVED">Approved</option>
                <option value="ORDERED">Ordered</option>
                <option value="RECEIVED">Received</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Purchase Orders List */}
      <div className="space-y-4">
        {purchaseOrders.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Package className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No purchase orders</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by creating a new purchase order.
              </p>
              <div className="mt-6">
                <Button onClick={() => router.push('/dashboard/purchase-orders/new')}>
                  <Plus className="mr-2 h-4 w-4" />
                  New PO
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          purchaseOrders.map((po) => (
            <Card
              key={po.id}
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => router.push(`/dashboard/purchase-orders/${po.id}`)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <Link href={`/dashboard/purchase-orders/${po.id}`}>
                      <CardTitle className="text-lg hover:text-primary cursor-pointer">
                        {po.poNumber}
                      </CardTitle>
                    </Link>
                    <CardDescription className="mt-1">
                      Vendor: {po.vendorRef?.name || po.vendor}
                      {po.job && ` • Job ${po.job.jobNumber}`}
                      {po.expectedDate && ` • Expected: ${formatDate(po.expectedDate)}`}
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-1 text-xs rounded-full ${statusColors[po.status] || 'bg-gray-100 text-gray-800'}`}>
                      {po.status}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {po.orderDate && `Order Date: ${formatDate(po.orderDate)}`}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold">{formatCurrency(po.total)}</div>
                    <div className="text-xs text-gray-500">
                      Subtotal: {formatCurrency(po.subtotal)}
                      {po.tax && po.tax > 0 && ` + Tax: ${formatCurrency(po.tax)}`}
                      {po.shipping && po.shipping > 0 && ` + Shipping: ${formatCurrency(po.shipping)}`}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
