'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Save, Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { FastPicker, FastPickerItem } from '@/components/items/FastPicker'

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
  id?: string
  description: string
  quantity: string
  unitCost: string // Primary field for POs
  unitPrice?: string // Optional, for reference
  notes?: string
  vendorId?: string
  vendorName?: string
  // Bundle support
  groupId?: string
  groupName?: string
  isGroupHeader?: boolean
  sourceItemId?: string
  sourceBundleId?: string
}

export default function EditPurchaseOrderPage() {
  const router = useRouter()
  const params = useParams()
  const poId = params?.id as string | undefined

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [pickerItems, setPickerItems] = useState<FastPickerItem[]>([])
  const [pickerBundles, setPickerBundles] = useState<FastPickerItem[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [poNumber, setPoNumber] = useState('')
  
  const [formData, setFormData] = useState({
    vendorId: '',
    jobId: '',
    status: 'DRAFT',
    expectedDate: '',
    orderDate: '',
    tax: '0',
    shipping: '0',
  })

  const lineItemRefs = useRef<(HTMLDivElement | null)[]>([])
  const pickerInputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (poId) {
      fetchVendors()
      fetchJobs()
      fetchPickerData()
      fetchPurchaseOrder()
    }
  }, [poId])

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

  const fetchPickerData = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/items/picker', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setPickerItems(data.items || [])
        setPickerBundles(data.bundles || [])
      }
    } catch (error) {
      console.error('Error fetching items for picker:', error)
    }
  }

  const fetchPurchaseOrder = async () => {
    if (!poId) return

    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/purchase-orders/${poId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        alert('Failed to load purchase order')
        router.push('/dashboard/purchase-orders')
        return
      }

      const data = await response.json()
      const po = data.purchaseOrder

      if (!po) {
        alert('Purchase order not found')
        router.push('/dashboard/purchase-orders')
        return
      }

      setPoNumber(po.poNumber)

      setFormData({
        vendorId: po.vendorId || '',
        jobId: po.jobId || '',
        status: po.status || 'DRAFT',
        expectedDate: po.expectedDate ? new Date(po.expectedDate).toISOString().split('T')[0] : '',
        orderDate: po.orderDate ? new Date(po.orderDate).toISOString().split('T')[0] : '',
        tax: data.purchaseOrder.tax?.toString() || '0',
        shipping: data.purchaseOrder.shipping?.toString() || '0',
      })

      // Map line items, handling groups
      const groupsMap = new Map<string, { name: string; sourceBundleId?: string }>()
      const mappedItems: LineItem[] = []
      
      po.lineItems?.forEach((li: any) => {
        if (li.group && !groupsMap.has(li.group.id)) {
          groupsMap.set(li.group.id, {
            name: li.group.name,
            sourceBundleId: li.group.sourceBundleId || undefined,
          })
        }
      })

      const processedGroups = new Set<string>()
      po.lineItems?.forEach((li: any) => {
        const group = li.group
        if (group && !processedGroups.has(group.id)) {
          mappedItems.push({
            id: `header-${group.id}`,
            description: group.name,
            quantity: '1',
            unitCost: '0',
            groupId: group.id,
            groupName: group.name,
            isGroupHeader: true,
            sourceBundleId: group.sourceBundleId || undefined,
          })
          processedGroups.add(group.id)
        }

        mappedItems.push({
          id: li.id,
          description: li.description,
          quantity: li.quantity.toString(),
          unitCost: li.unitCost ? li.unitCost.toString() : li.unitPrice.toString(), // PO uses unitPrice for cost
          unitPrice: li.unitPrice ? li.unitPrice.toString() : undefined,
          notes: li.notes || undefined,
          vendorId: li.vendorId || undefined,
          vendorName: li.vendor?.name || undefined,
          groupId: li.groupId || undefined,
          sourceItemId: li.sourceItemId || undefined,
          sourceBundleId: li.sourceBundleId || undefined,
        })
      })

      if (mappedItems.length === 0) {
        mappedItems.push({
          description: '',
          quantity: '1',
          unitCost: '0',
        })
      }

      setLineItems(mappedItems)
    } catch (error) {
      console.error('Error fetching purchase order:', error)
      alert('Failed to load purchase order')
    } finally {
      setLoading(false)
    }
  }

  const addLineItem = () => {
    setLineItems([
      ...lineItems,
      {
        description: '',
        quantity: '1',
        unitCost: '0',
      },
    ])
  }

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      const item = lineItems[index]
      if (item.groupId && item.isGroupHeader) {
        setLineItems(lineItems.filter((li, i) => li.groupId !== item.groupId || i === index))
      } else {
        setLineItems(lineItems.filter((_, i) => i !== index))
      }
    }
  }

  const updateLineItem = (index: number, field: keyof LineItem, value: any) => {
    const updated = [...lineItems]
    updated[index] = { ...updated[index], [field]: value }
    setLineItems(updated)
  }

  const handleItemSelect = async (item: FastPickerItem, lineIndex: number) => {
    const updated = [...lineItems]

    if (item.kind === 'BUNDLE') {
      try {
        const token = localStorage.getItem('accessToken')
        const bundleDefId = item.bundleId || item.id
        
        const response = await fetch(`/api/items/bundles/${bundleDefId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        
        if (response.ok) {
          const bundleData = await response.json()
          const bundle = bundleData.bundle
          const components = bundle?.components || []
          
          const groupId = `group-${Date.now()}`
          updated[lineIndex] = {
            ...updated[lineIndex],
            description: bundle?.name || item.name,
            quantity: '1',
            unitCost: '0',
            groupId,
            groupName: bundle?.name || item.name,
            isGroupHeader: true,
            sourceBundleId: bundleDefId,
          }

          const childLines: LineItem[] = components.map((comp: any) => {
            const sourceItem = comp.componentItem
            const sourceBundle = comp.componentBundle
            const sourceName = sourceItem?.name || sourceBundle?.item?.name || 'Unknown'
            const sourceCost = sourceItem?.defaultUnitCost 
              ? Number(sourceItem.defaultUnitCost)
              : (sourceBundle ? Number(bundle?.item?.defaultUnitCost || 0) : 0)
            
            const overrideCost = comp.defaultUnitCostOverride
              ? Number(comp.defaultUnitCostOverride)
              : sourceCost

            return {
              description: sourceName,
              quantity: comp.quantity.toString(),
              unitCost: overrideCost.toString(),
              unitPrice: sourceItem?.defaultUnitPrice?.toString() || '0',
              notes: comp.notes || '',
              vendorId: comp.vendorId || item.vendorId || null,
              vendorName: comp.vendor?.name || item.vendorName || null,
              groupId,
              sourceItemId: comp.componentItemId || null,
              sourceBundleId: comp.componentBundleId || null,
            }
          })

          updated.splice(lineIndex + 1, 0, ...childLines)
        } else {
          updated[lineIndex] = {
            ...updated[lineIndex],
            description: item.name,
            quantity: '1',
            unitCost: item.defaultUnitCost?.toString() || '0',
            unitPrice: item.defaultUnitPrice.toString(),
            vendorId: item.vendorId || null,
            vendorName: item.vendorName || null,
            sourceBundleId: bundleDefId,
          }
        }
      } catch (error) {
        console.error('Error fetching bundle details:', error)
        updated[lineIndex] = {
          ...updated[lineIndex],
          description: item.name,
          quantity: '1',
          unitCost: item.defaultUnitCost?.toString() || '0',
          unitPrice: item.defaultUnitPrice.toString(),
          vendorId: item.vendorId || null,
          vendorName: item.vendorName || null,
          sourceBundleId: item.bundleId || undefined,
        }
      }
    } else {
      updated[lineIndex] = {
        ...updated[lineIndex],
        description: item.name,
        quantity: '1',
        unitCost: item.defaultUnitCost?.toString() || '0',
        unitPrice: item.defaultUnitPrice.toString(),
        notes: item.notes || '',
        vendorId: item.vendorId || null,
        vendorName: item.vendorName || null,
        sourceItemId: item.id,
      }
    }

    setLineItems(updated)
    
    // Return a promise that resolves after state update
    // Use requestAnimationFrame to ensure React has processed the state update
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          resolve()
        }, 0)
      })
    })
  }

  const handleNextLine = (currentIndex: number) => {
    const nextIndex = currentIndex + 1
    if (nextIndex >= lineItems.length) {
      addLineItem()
    }
    setTimeout(() => {
      const nextInput = pickerInputRefs.current[nextIndex]
      if (nextInput) {
        nextInput.focus()
        nextInput.dispatchEvent(new Event('focus', { bubbles: true }))
      } else {
        const nextContainer = lineItemRefs.current[nextIndex]
        const fallbackInput = nextContainer?.querySelector<HTMLInputElement>('[data-picker-input="true"]')
        if (fallbackInput) {
          fallbackInput.focus()
          fallbackInput.dispatchEvent(new Event('focus', { bubbles: true }))
        }
      }
    }, 100)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.vendorId) {
      alert('Please select a vendor')
      return
    }

    setSaving(true)
    try {
      const token = localStorage.getItem('accessToken')
      
      const subtotal = lineItems.reduce((sum, item) => {
        if (item.isGroupHeader) return sum
        return sum + parseFloat(item.quantity || '0') * parseFloat(item.unitCost || '0')
      }, 0)
      
      const tax = parseFloat(formData.tax || '0')
      const shipping = parseFloat(formData.shipping || '0')
      const total = subtotal + tax + shipping

      const apiLineItems = lineItems
        .filter(item => !item.isGroupHeader)
        .map((item, index) => ({
          id: item.id,
          description: item.description,
          quantity: parseFloat(item.quantity || '1'),
          unitPrice: parseFloat(item.unitCost || '0'), // PO uses unitPrice field for cost
          unitCost: parseFloat(item.unitCost || '0'),
          total: parseFloat(item.quantity || '1') * parseFloat(item.unitCost || '0'),
          sortOrder: index,
          vendorId: item.vendorId || null,
          notes: item.notes || null,
          groupId: item.groupId || null,
          sourceItemId: item.sourceItemId || null,
          sourceBundleId: item.sourceBundleId || null,
        }))

      const groups = new Map<string, { name: string; sourceBundleId?: string }>()
      lineItems.forEach(item => {
        if (item.groupId && item.groupName && !groups.has(item.groupId)) {
          groups.set(item.groupId, {
            name: item.groupName,
            sourceBundleId: item.sourceBundleId,
          })
        }
      })

      const response = await fetch(`/api/purchase-orders/${poId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          vendorId: formData.vendorId,
          jobId: formData.jobId || null,
          status: formData.status,
          expectedDate: formData.expectedDate || null,
          orderDate: formData.orderDate || new Date().toISOString().split('T')[0],
          tax,
          shipping,
          total,
          lineItems: apiLineItems,
          groups: Array.from(groups.entries()).map(([groupId, group]) => ({
            groupId,
            ...group,
          })),
        }),
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to update purchase order' }))
        alert(errorData.error || 'Failed to update purchase order')
        return
      }

      router.push(`/dashboard/purchase-orders/${poId}`)
    } catch (error) {
      console.error('Error updating purchase order:', error)
      alert('Failed to update purchase order. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const subtotal = lineItems.reduce((sum, item) => {
    if (item.isGroupHeader) return sum
    return sum + parseFloat(item.quantity || '0') * parseFloat(item.unitCost || '0')
  }, 0)
  
  const tax = parseFloat(formData.tax || '0')
  const shipping = parseFloat(formData.shipping || '0')
  const total = subtotal + tax + shipping

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

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href={`/dashboard/purchase-orders/${poId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Edit Purchase Order</h1>
          <p className="mt-2 text-gray-600">PO #{poNumber}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Purchase Order Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="vendorId">Vendor *</Label>
                  <select
                    id="vendorId"
                    required
                    value={formData.vendorId}
                    onChange={(e) => setFormData({ ...formData, vendorId: e.target.value })}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Select a vendor...</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="jobId">Job (Optional)</Label>
                  <select
                    id="jobId"
                    value={formData.jobId}
                    onChange={(e) => setFormData({ ...formData, jobId: e.target.value })}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">No job</option>
                    {jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.jobNumber} - {job.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="orderDate">Order Date *</Label>
                    <Input
                      id="orderDate"
                      type="date"
                      required
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
                  <Label htmlFor="status">Status</Label>
                  <select
                    id="status"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="PENDING_APPROVAL">Pending Approval</option>
                    <option value="APPROVED">Approved</option>
                    <option value="ORDERED">Ordered</option>
                    <option value="RECEIVED">Received</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Line Items</CardTitle>
                <CardDescription>Click in Description field to search and add items. Focus on vendor costs.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="space-y-2">
                  {lineItems.map((item, index) => {
                    const isGroupHeader = item.isGroupHeader
                    const isInGroup = !!item.groupId && !isGroupHeader
                    
                    return (
                      <div
                        key={index}
                        ref={(el) => {
                          lineItemRefs.current[index] = el
                        }}
                        className={`flex gap-2 items-end p-2 rounded border ${
                          isGroupHeader
                            ? 'bg-purple-50 border-purple-200'
                            : isInGroup
                            ? 'bg-purple-25 border-purple-100 ml-4'
                            : 'border-gray-300'
                        }`}
                      >
                        <div className="flex-1">
                          {isGroupHeader ? (
                            <div className="flex items-center gap-2">
                              <Input
                                value={item.description}
                                onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                                placeholder="Bundle name"
                                className="flex-1 font-semibold"
                                readOnly
                              />
                              <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">
                                Bundle
                              </span>
                            </div>
                          ) : (
                            <FastPicker
                              value={item.description}
                              onChange={(value) => updateLineItem(index, 'description', value)}
                              onSelect={(selectedItem) => handleItemSelect(selectedItem, index)}
                              onNextLine={() => handleNextLine(index)}
                              items={pickerItems}
                              bundles={pickerBundles}
                              placeholder="Type to search items..."
                              className="w-full"
                              inputRef={(el) => {
                                pickerInputRefs.current[index] = el
                              }}
                            />
                          )}
                        </div>

                        {!isGroupHeader && (
                          <>
                            <div className="w-20">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Qty"
                                value={item.quantity}
                                onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
                                required
                              />
                            </div>

                            <div className="w-32">
                              <Label className="text-xs text-gray-500 mb-1 block">Vendor Cost *</Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={item.unitCost}
                                onChange={(e) => updateLineItem(index, 'unitCost', e.target.value)}
                                required
                                className="font-semibold"
                              />
                            </div>

                            {item.unitPrice && parseFloat(item.unitPrice) > 0 && (
                              <div className="w-28">
                                <Label className="text-xs text-gray-400 mb-1 block">Sale Price</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  value={item.unitPrice}
                                  onChange={(e) => updateLineItem(index, 'unitPrice', e.target.value)}
                                  className="bg-gray-50 text-gray-500"
                                  readOnly
                                />
                              </div>
                            )}
                          </>
                        )}

                        {lineItems.length > 1 && !isGroupHeader && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (item.groupId) {
                                setLineItems(lineItems.filter((li, i) => li.groupId !== item.groupId || i === index))
                              } else {
                                removeLineItem(index)
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
                <Button type="button" variant="outline" onClick={addLineItem}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Line Item
                </Button>
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
                  <span>Subtotal:</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                <div>
                  <Label htmlFor="tax">Tax ($)</Label>
                  <Input
                    id="tax"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.tax}
                    onChange={(e) => setFormData({ ...formData, tax: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="shipping">Shipping/Fees ($)</Label>
                  <Input
                    id="shipping"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.shipping}
                    onChange={(e) => setFormData({ ...formData, shipping: e.target.value })}
                  />
                </div>
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>Total:</span>
                  <span>${total.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col space-y-2">
              <Button type="submit" disabled={saving} className="w-full">
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : 'Save Changes'}
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
