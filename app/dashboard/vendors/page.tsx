'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, Filter, Download, Upload, Trash2, Edit, Eye, Building2 } from 'lucide-react'
import Link from 'next/link'

interface Vendor {
  id: string
  name: string
  vendorCode: string | null
  status: string
  email: string | null
  phone: string | null
  paymentTerms: string
  contacts: Array<{
    id: string
    name: string
    email: string | null
    phone: string | null
    isPrimary: boolean
  }>
  _count: {
    purchaseOrders: number
    items: number
  }
  updatedAt: string
}

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-gray-100 text-gray-800',
}

const paymentTermsLabels: Record<string, string> = {
  NET_15: 'Net 15',
  NET_30: 'Net 30',
  NET_45: 'Net 45',
  DUE_ON_RECEIPT: 'Due on Receipt',
  CUSTOM: 'Custom',
}

export default function VendorsPage() {
  const router = useRouter()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentTermsFilter, setPaymentTermsFilter] = useState('all')

  useEffect(() => {
    fetchVendors()
  }, [search, statusFilter, paymentTermsFilter])

  const fetchVendors = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const params = new URLSearchParams({
        search,
        status: statusFilter,
        paymentTerms: paymentTermsFilter !== 'all' ? paymentTermsFilter : '',
        page: '1',
        limit: '100',
      })

      const response = await fetch(`/api/vendors?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        console.error('Failed to fetch vendors')
        setVendors([])
        setLoading(false)
        return
      }

      const data = await response.json()
      setVendors(data.vendors || [])
    } catch (error) {
      console.error('Error fetching vendors:', error)
      setVendors([])
    } finally {
      setLoading(false)
    }
  }

  const handleArchive = async (vendorId: string, currentStatus: string) => {
    if (!confirm(`Are you sure you want to ${currentStatus === 'ACTIVE' ? 'archive' : 'activate'} this vendor?`)) {
      return
    }

    try {
      const token = localStorage.getItem('accessToken')
      const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
      const response = await fetch(`/api/vendors/${vendorId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      })

      if (response.ok) {
        fetchVendors()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to update vendor status')
      }
    } catch (error) {
      console.error('Error updating vendor status:', error)
      alert('Failed to update vendor status')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading vendors...</p>
        </div>
      </div>
    )
  }

  const primaryContact = (vendor: Vendor) => {
    return vendor.contacts.find(c => c.isPrimary) || vendor.contacts[0] || null
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Vendors</h1>
          <p className="mt-2 text-gray-600">Manage your suppliers and vendors</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button onClick={() => {}} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button onClick={() => {}} variant="outline">
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
          <Button onClick={() => router.push('/dashboard/vendors/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Vendor
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search vendors..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              value={paymentTermsFilter}
              onChange={(e) => setPaymentTermsFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="all">All Payment Terms</option>
              <option value="NET_15">Net 15</option>
              <option value="NET_30">Net 30</option>
              <option value="NET_45">Net 45</option>
              <option value="DUE_ON_RECEIPT">Due on Receipt</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Vendors Table */}
      <Card>
        <CardHeader>
          <CardTitle>Vendors ({vendors.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {vendors.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No vendors found</h3>
              <p className="text-gray-600 mb-4">
                {search || statusFilter !== 'all' || paymentTermsFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Get started by creating your first vendor'}
              </p>
              <div className="flex justify-center space-x-2">
                <Button onClick={() => router.push('/dashboard/vendors/new')}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Vendor
                </Button>
                <Button variant="outline" onClick={() => {}}>
                  <Upload className="mr-2 h-4 w-4" />
                  Import CSV
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold">Vendor Name</th>
                    <th className="text-left py-3 px-4 font-semibold">Primary Contact</th>
                    <th className="text-left py-3 px-4 font-semibold">Email</th>
                    <th className="text-left py-3 px-4 font-semibold">Phone</th>
                    <th className="text-left py-3 px-4 font-semibold">Payment Terms</th>
                    <th className="text-left py-3 px-4 font-semibold">Status</th>
                    <th className="text-left py-3 px-4 font-semibold">Last Updated</th>
                    <th className="text-right py-3 px-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((vendor) => {
                    const contact = primaryContact(vendor)
                    return (
                      <tr key={vendor.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <Link href={`/dashboard/vendors/${vendor.id}`} className="text-primary hover:underline font-medium">
                            {vendor.name}
                          </Link>
                          {vendor.vendorCode && (
                            <div className="text-sm text-gray-500">Code: {vendor.vendorCode}</div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {contact ? (
                            <div>
                              <div className="font-medium">{contact.name}</div>
                              {contact.title && <div className="text-sm text-gray-500">{contact.title}</div>}
                            </div>
                          ) : (
                            <span className="text-gray-400">No contact</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {contact?.email || vendor.email || <span className="text-gray-400">-</span>}
                        </td>
                        <td className="py-3 px-4">
                          {contact?.phone || vendor.phone || <span className="text-gray-400">-</span>}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm">
                            {paymentTermsLabels[vendor.paymentTerms] || vendor.paymentTerms}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-1 text-xs rounded-full ${statusColors[vendor.status] || 'bg-gray-100 text-gray-800'}`}>
                            {vendor.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {formatDate(vendor.updatedAt)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end space-x-2">
                            <Link href={`/dashboard/vendors/${vendor.id}`}>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={`/dashboard/vendors/${vendor.id}/edit`}>
                              <Button variant="ghost" size="sm">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleArchive(vendor.id, vendor.status)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
