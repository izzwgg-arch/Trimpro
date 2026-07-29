'use client'
import { EntityBackButton } from '@/components/navigation/EntityBackButton'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableJobSelect } from '@/components/ui/searchable-job-select'
import { Save, Plus, Trash2, Copy } from 'lucide-react'
import Link from 'next/link'
import { LineItemDragHandle } from '@/components/documents/line-item-drag-handle'
import { FastPicker, FastPickerItem } from '@/components/items/FastPicker'
import {
  catalogNotesFromItem,
  expandBundleComponentsToLineItems,
  bundleExpandedLineToPurchaseOrderLine,
} from '@/lib/bundles/expand-line-items'
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
  status?: string | null
  client?: { id?: string; name?: string | null; companyName?: string | null } | null
}

interface LineItem {
  id?: string
  description: string
  details?: string
  quantity: string
  unitCost: string // Primary field for POs
  unitPrice?: string // Optional, for reference
  notes?: string
  vendorId?: string | null
  vendorName?: string | null
  // Bundle support
  groupId?: string
  groupName?: string
  isGroupHeader?: boolean
  sourceItemId?: string | null
  sourceBundleId?: string | null
  tag?: string
}

export default function EditPurchaseOrderPage() {
  const router = useRouter()
  const params = useParams()
  const poId = params?.id as string | undefined

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
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
    notes: '',
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
        notes: po.notes || '',
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
          details: li.details || undefined,
          quantity: li.quantity.toString(),
          unitCost: li.unitCost ? li.unitCost.toString() : li.unitPrice.toString(), // PO uses unitPrice for cost
          unitPrice: li.unitPrice ? li.unitPrice.toString() : undefined,
          notes: li.notes || undefined,
          vendorId: li.vendorId || undefined,
          vendorName: li.vendor?.name || undefined,
          groupId: li.groupId || undefined,
          sourceItemId: li.sourceItemId || undefined,
          sourceBundleId: li.sourceBundleId || undefined,
        tag: '',
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
    setLineItems((prev) => [
      ...prev,
      {
        description: '',
        quantity: '1',
        unitCost: '0',
      },
    ])
  }

  const removeLineItem = (index: number) => {
    setLineItems((prev) => {
      if (prev.length <= 1) return prev
      const item = prev[index]
      if (item?.groupId && item.isGroupHeader) {
        return prev.filter((li, i) => li.groupId !== item.groupId || i === index)
      }
      return prev.filter((_, i) => i !== index)
    })
  }

  const updateLineItem = (index: number, field: keyof LineItem, value: any) => {
    setLineItems((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  const reorderLineItems = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    setLineItems((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  const maybeAutoScrollDuringDrag = (clientY: number) => {
    const edge = 120
    const step = 26
    if (clientY > window.innerHeight - edge) {
      window.scrollBy({ top: step, behavior: 'auto' })
    } else if (clientY < edge) {
      window.scrollBy({ top: -step, behavior: 'auto' })
    }
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

          const expanded = await expandBundleComponentsToLineItems(
            components,
            groupId,
            token || ''
          )
          const childLines: LineItem[] = expanded.map((line) =>
            bundleExpandedLineToPurchaseOrderLine(line, {
              vendorId: item.vendorId,
              vendorName: item.vendorName,
              sourceBundleId: bundleDefId,
            })
          )

          updated.splice(lineIndex + 1, 0, ...childLines)
        } else {
          updated[lineIndex] = {
            ...updated[lineIndex],
            description: item.name,
            quantity: '1',
            unitCost: item.defaultUnitCost?.toString() || '0',
            unitPrice: item.defaultUnitPrice.toString(),
            details: catalogNotesFromItem(item),
            notes: '',
            vendorId: item.vendorId || null,
            vendorName: item.vendorName || null,
            sourceBundleId: bundleDefId,
            tag: item.tag || '',
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
          details: catalogNotesFromItem(item),
          notes: '',
          vendorId: item.vendorId || null,
          vendorName: item.vendorName || null,
          sourceBundleId: item.bundleId || undefined,
          tag: item.tag || '',
        }
      }
    } else {
      updated[lineIndex] = {
        ...updated[lineIndex],
        description: item.name,
        quantity: '1',
        unitCost: item.defaultUnitCost?.toString() || '0',
        unitPrice: item.defaultUnitPrice.toString(),
        details: catalogNotesFromItem(item),
        notes: '',
        vendorId: item.vendorId || null,
        vendorName: item.vendorName || null,
        sourceItemId: item.id,
        tag: item.tag || '',
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
    setLineItems((prev) => {
      if (nextIndex < prev.length) return prev
      return [
        ...prev,
        {
          description: '',
          quantity: '1',
          unitCost: '0',
        },
      ]
    })
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
          details: item.details || null,
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
            sourceBundleId: item.sourceBundleId || undefined,
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
          notes: formData.notes || null,
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

      router.replace(`/dashboard/purchase-orders/${poId}`)
    } catch (error) {
      console.error('Error updating purchase order:', error)
      alert('Failed to update purchase order. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDuplicate = async () => {
    if (!poId) return
    setDuplicating(true)
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/purchase-orders/${poId}/duplicate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(data.error || 'Failed to duplicate purchase order')
        return
      }
      if (data?.id) {
        router.push(`/dashboard/purchase-orders/${data.id}/edit`)
      } else {
        router.push('/dashboard/purchase-orders')
      }
    } catch (error) {
      console.error('Duplicate purchase order error:', error)
      alert('Failed to duplicate purchase order')
    } finally {
      setDuplicating(false)
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
        <EntityBackButton fallbackHref={`/dashboard/purchase-orders/${poId}`} parentHref={`/dashboard/purchase-orders/${poId}`} mode="parent" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Edit Purchase Order</h1>
          <p className="mt-2 text-gray-600">PO #{poNumber}</p>
        </div>
        <Button type="button" variant="outline" onClick={handleDuplicate} disabled={duplicating}>
          <Copy className="mr-2 h-4 w-4" />
          {duplicating ? 'Duplicating...' : 'Duplicate'}
        </Button>
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
                  <Select
                    value={formData.vendorId}
                    onValueChange={(value) => setFormData({ ...formData, vendorId: value })}
                  >
                    <SelectTrigger id="vendorId">
                      <SelectValue placeholder="Select a vendor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((vendor) => (
                        <SelectItem key={vendor.id} value={vendor.id}>
                          {vendor.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="jobId">Job (Optional)</Label>
                  <SearchableJobSelect
                    jobs={jobs}
                    value={formData.jobId || ''}
                    onSelect={(jobId) => setFormData({ ...formData, jobId })}
                    placeholder="Search jobs by number, title, or client..."
                    allowNone
                    noneLabel="No job"
                  />
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
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger id="status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                      <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
                      <SelectItem value="APPROVED">Approved</SelectItem>
                      <SelectItem value="ORDERED">Ordered</SelectItem>
                      <SelectItem value="RECEIVED">Received</SelectItem>
                      <SelectItem value="CANCELLED">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Purchase order notes"
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Line Items</CardTitle>
                <CardDescription>Click in Item to search and add catalog products. Focus on vendor costs.</CardDescription>
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
                        data-line-item-row={index}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          maybeAutoScrollDuringDrag(e.clientY)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          const from = parseInt(e.dataTransfer.getData('text/line-index'), 10)
                          if (!Number.isFinite(from)) return
                          reorderLineItems(from, index)
                        }}
                        className={`flex gap-2 ${isGroupHeader ? 'items-center' : 'items-start'} p-2 rounded border ${
                          isGroupHeader
                            ? 'bg-purple-50 border-purple-200'
                            : isInGroup
                            ? 'bg-purple-25 border-purple-100 ml-4'
                            : 'border-gray-300'
                        }`}
                      >
                        <div
                          className={`flex flex-col gap-1 items-center shrink-0 ${isGroupHeader ? 'self-center' : 'self-start pt-1'}`}
                        >
                          <LineItemDragHandle transferKey="text/line-index" index={index} />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-1">
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
                            <>
                              <div>
                                <Label className="text-xs text-gray-500 mb-1 block">Item</Label>
                                <FastPicker
                                  value={item.description}
                                  onChange={(value) => updateLineItem(index, 'description', value)}
                                  onSelect={(selectedItem) => handleItemSelect(selectedItem, index)}
                                  onNextLine={() => handleNextLine(index)}
                                  items={pickerItems}
                                  bundles={pickerBundles}
                                  placeholder="Type to search items..."
                                  className="w-full"
                                  showTagColumn
                                  inputRef={(el) => {
                                    pickerInputRefs.current[index] = el
                                  }}
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-gray-500 mb-1 block">Description</Label>
                                <textarea
                                  value={item.details || ''}
                                  onChange={(e) => updateLineItem(index, 'details', e.target.value)}
                                  placeholder="Description"
                                  rows={2}
                                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-gray-500 mb-1 block">Special notes</Label>
                                <textarea
                                  value={item.notes || ''}
                                  onChange={(e) => updateLineItem(index, 'notes', e.target.value)}
                                  placeholder="Special notes"
                                  rows={2}
                                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                                />
                              </div>
                            </>
                          )}
                        </div>

                        {!isGroupHeader && (
                          <div className="flex gap-2 items-end shrink-0">
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

                            <div className="w-36">
                              <Label className="text-xs text-gray-500 mb-1 block">Tag</Label>
                              <Input
                                value={item.tag || ''}
                                placeholder="-"
                                className="bg-white text-gray-700"
                                onChange={(e) => updateLineItem(index, 'tag', e.target.value)}
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
                          </div>
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
