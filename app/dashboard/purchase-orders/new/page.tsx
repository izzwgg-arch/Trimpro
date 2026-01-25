'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Save, Plus, Trash2, Package } from 'lucide-react'
import Link from 'next/link'
import { ItemPicker } from '@/components/items/ItemPicker'

interface Vendor {
  id: string
  name: string
  email: string | null
  phone: string | null
  contactPerson: string | null
}

interface Job {
  id: string
  jobNumber: string
  title: string
}

interface LineItem {
  description: string
  quantity: string
  unitPrice: string
}

export default function NewPurchaseOrderPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const jobIdParam = searchParams.get('jobId')
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', quantity: '1', unitPrice: '0' }])
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [itemPickerIndex, setItemPickerIndex] = useState<number | null>(null)
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null)
  const [formData, setFormData] = useState({
    vendorId: '',
    vendor: '',
    poNumber: '',
    jobId: jobIdParam || '',
    status: 'DRAFT',
    expectedDate: '',
    orderDate: '',
    tax: '0',
    shipping: '0',
  })

  useEffect(() => {
    fetchVendors()
    fetchJobs()
  }, [])

  const fetchVendors = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/vendors?limit=1000', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setVendors(data.vendors || [])
      }
    } catch (error) {
      console.error('Error fetching vendors:', error)
    }
  }

  const fetchJobs = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/jobs?limit=1000', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setJobs(data.jobs || [])
      }
    } catch (error) {
      console.error('Error fetching jobs:', error)
    }
  }

  const addLineItem = () => {
    setLineItems([...lineItems, { description: '', quantity: '1', unitPrice: '0' }])
  }

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index))
  }

  const updateLineItem = (index: number, field: keyof LineItem, value: string) => {
    const updated = [...lineItems]
    updated[index] = { ...updated[index], [field]: value }
    setLineItems(updated)
  }

  const handleItemSelect = (item: any) => {
    const index = itemPickerIndex ?? lineItems.length - 1
    const updated = [...lineItems]
    updated[index] = {
      description: item.name + (item.description ? ` - ${item.description}` : ''),
      quantity: '1',
      unitPrice: item.defaultUnitPrice.toString(),
    }
    setLineItems(updated)
    setShowItemPicker(false)
    setItemPickerIndex(null)
  }

  const openItemPicker = (index?: number) => {
    setItemPickerIndex(index ?? null)
    setShowItemPicker(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          vendorId: formData.vendorId || null,
          vendor: formData.vendor,
          status: formData.status,
          jobId: formData.jobId || null,
          expectedDate: formData.expectedDate || null,
          orderDate: formData.orderDate || new Date().toISOString().split('T')[0],
          tax: parseFloat(formData.tax) || 0,
          shipping: parseFloat(formData.shipping) || 0,
          lineItems: lineItems.map(item => ({
            description: item.description,
            quantity: parseFloat(item.quantity) || 0,
            unitPrice: parseFloat(item.unitPrice) || 0,
          })),
        }),
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to create purchase order')
        return
      }

      const data = await response.json()
      router.push(`/dashboard/purchase-orders/${data.purchaseOrder.id}`)
    } catch (error) {
      console.error('Error creating purchase order:', error)
      alert('Failed to create purchase order')
    } finally {
      setLoading(false)
    }
  }

  const handleVendorChange = (vendorId: string) => {
    const vendor = vendors.find((v) => v.id === vendorId)
    setSelectedVendor(vendor || null)
    setFormData({
      ...formData,
      vendorId: vendorId || '',
      vendor: vendor?.name || '',
    })
  }

  const calculateSubtotal = () => {
    return lineItems.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0
      const price = parseFloat(item.unitPrice) || 0
      return sum + (qty * price)
    }, 0)
  }

  const calculateTotal = () => {
    const subtotal = calculateSubtotal()
    const tax = parseFloat(formData.tax) || 0
    const shipping = parseFloat(formData.shipping) || 0
    return subtotal + tax + shipping
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href="/dashboard/purchase-orders">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">New Purchase Order</h1>
          <p className="mt-2 text-gray-600">Create a new purchase order</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Purchase Order Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="vendorId">Vendor *</Label>
                  <select
                    id="vendorId"
                    required
                    value={formData.vendorId}
                    onChange={(e) => handleVendorChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </select>
                  {selectedVendor && (
                    <div className="mt-2 p-3 bg-gray-50 rounded-md text-sm">
                      {selectedVendor.email && <p>Email: {selectedVendor.email}</p>}
                      {selectedVendor.phone && <p>Phone: {selectedVendor.phone}</p>}
                      {selectedVendor.contactPerson && <p>Contact: {selectedVendor.contactPerson}</p>}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="poNumber">PO Number</Label>
                    <Input
                      id="poNumber"
                      value={formData.poNumber}
                      onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
                      placeholder="Auto-generated if empty"
                    />
                  </div>
                  <div>
                    <Label htmlFor="status">Status</Label>
                    <select
                      id="status"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="PENDING_APPROVAL">Pending Approval</option>
                      <option value="APPROVED">Approved</option>
                      <option value="ORDERED">Ordered</option>
                      <option value="RECEIVED">Received</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="orderDate">Order Date</Label>
                    <Input
                      id="orderDate"
                      type="date"
                      value={formData.orderDate}
                      onChange={(e) => setFormData({ ...formData, orderDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="expectedDate">Expected Delivery Date</Label>
                    <Input
                      id="expectedDate"
                      type="date"
                      value={formData.expectedDate}
                      onChange={(e) => setFormData({ ...formData, expectedDate: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="jobId">Job</Label>
                  <select
                    id="jobId"
                    value={formData.jobId}
                    onChange={(e) => setFormData({ ...formData, jobId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a job</option>
                    {jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.jobNumber} - {job.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Line Items *</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() => openItemPicker()}>
                      <Package className="mr-2 h-4 w-4" />
                      Add from Items
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {lineItems.map((item, index) => (
                      <div key={index} className="flex gap-2 items-end">
                        <div className="flex-1">
                          <div className="flex gap-2">
                            <Input
                              placeholder="Description"
                              value={item.description}
                              onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                              required
                              className="flex-1"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openItemPicker(index)}
                              title="Select from items"
                            >
                              <Package className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="w-24">
                          <Input
                            type="number"
                            placeholder="Qty"
                            value={item.quantity}
                            onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
                            required
                          />
                        </div>
                        <div className="w-32">
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Price"
                            value={item.unitPrice}
                            onChange={(e) => updateLineItem(index, 'unitPrice', e.target.value)}
                            required
                          />
                        </div>
                        {lineItems.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLineItem(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="outline" onClick={addLineItem}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Line Item
                    </Button>
                  </div>
                </div>
                {showItemPicker && (
                  <ItemPicker
                    onSelect={handleItemSelect}
                    onClose={() => {
                      setShowItemPicker(false)
                      setItemPickerIndex(null)
                    }}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Totals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">${calculateSubtotal().toFixed(2)}</span>
                </div>
                <div>
                  <Label htmlFor="tax">Tax</Label>
                  <Input
                    id="tax"
                    type="number"
                    step="0.01"
                    value={formData.tax}
                    onChange={(e) => setFormData({ ...formData, tax: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="shipping">Shipping / Fees</Label>
                  <Input
                    id="shipping"
                    type="number"
                    step="0.01"
                    value={formData.shipping}
                    onChange={(e) => setFormData({ ...formData, shipping: e.target.value })}
                  />
                </div>
                <div className="flex justify-between pt-3 border-t">
                  <span className="font-bold">Total</span>
                  <span className="text-xl font-bold">${calculateTotal().toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col space-y-2">
              <Button type="submit" disabled={loading} className="w-full">
                <Save className="mr-2 h-4 w-4" />
                {loading ? 'Creating...' : 'Create Purchase Order'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()} className="w-full">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
