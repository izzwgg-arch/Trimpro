'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Save, Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { FastPicker, FastPickerItem } from '@/components/items/FastPicker'

interface Client {
  id: string
  name: string
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
  unitPrice: string
  unitCost?: string
  notes?: string
  vendorId?: string
  vendorName?: string
  taxable: boolean
  taxRate?: string
  // Per-field visibility
  showCostToCustomer: boolean
  showPriceToCustomer: boolean
  showTaxToCustomer: boolean
  showNotesToCustomer: boolean
  // Bundle support
  groupId?: string
  groupName?: string
  isGroupHeader?: boolean
  sourceItemId?: string
  sourceBundleId?: string
}

export default function NewInvoicePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientIdParam = searchParams.get('clientId')
  const jobIdParam = searchParams.get('jobId')
  const estimateIdParam = searchParams.get('estimateId')
  
  const [loading, setLoading] = useState(false)
  const [clients, setClients] = useState<Client[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [pickerItems, setPickerItems] = useState<FastPickerItem[]>([])
  const [pickerBundles, setPickerBundles] = useState<FastPickerItem[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([
    {
      description: '',
      quantity: '1',
      unitPrice: '0',
      taxable: true,
      showCostToCustomer: false,
      showPriceToCustomer: true,
      showTaxToCustomer: true,
      showNotesToCustomer: false,
    },
  ])
  const [isNotesVisibleToClient, setIsNotesVisibleToClient] = useState(true)
  
  const [formData, setFormData] = useState({
    clientId: clientIdParam || '',
    jobId: jobIdParam || '',
    estimateId: estimateIdParam || '',
    title: '',
    taxRate: '0',
    discount: '0',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    notes: '',
    terms: '',
    memo: '',
  })

  const lineItemRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    fetchClients()
    fetchPickerData()
    if (formData.clientId) {
      fetchJobs()
    }
    if (estimateIdParam) {
      loadFromEstimate()
    }
  }, [formData.clientId, estimateIdParam])

  const fetchClients = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/clients?limit=1000', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setClients(data.clients || [])
      }
    } catch (error) {
      console.error('Error fetching clients:', error)
    }
  }

  const fetchJobs = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/jobs?clientId=${formData.clientId}&limit=1000`, {
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

  const loadFromEstimate = async () => {
    if (!estimateIdParam) return
    
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/estimates/${estimateIdParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      
      if (response.ok) {
        const data = await response.json()
        const est = data.estimate
        
        setFormData(prev => ({
          ...prev,
          clientId: est.client?.id || prev.clientId,
          title: est.title || prev.title,
          taxRate: est.taxRate ? (parseFloat(est.taxRate) * 100).toString() : prev.taxRate,
          discount: est.discount || prev.discount,
          notes: est.notes || prev.notes,
          terms: est.terms || prev.terms,
        }))
        
        // Map estimate line items to invoice line items
        const groupsMap = new Map<string, { name: string; sourceBundleId?: string }>()
        const mappedItems: LineItem[] = []
        
        est.lineItems?.forEach((li: any) => {
          if (li.group && !groupsMap.has(li.group.id)) {
            groupsMap.set(li.group.id, {
              name: li.group.name,
              sourceBundleId: li.group.sourceBundleId || undefined,
            })
          }
        })
        
        const processedGroups = new Set<string>()
        est.lineItems?.forEach((li: any) => {
          const group = li.group
          if (group && !processedGroups.has(group.id)) {
            mappedItems.push({
              id: `header-${group.id}`,
              description: group.name,
              quantity: '1',
              unitPrice: '0',
              taxable: true,
              showCostToCustomer: false,
              showPriceToCustomer: true,
              showTaxToCustomer: true,
              showNotesToCustomer: false,
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
            unitPrice: li.unitPrice.toString(),
            unitCost: li.unitCost ? li.unitCost.toString() : undefined,
            notes: li.notes || undefined,
            vendorId: li.vendorId || undefined,
            vendorName: li.vendorName || undefined,
            taxable: li.taxable ?? true,
            taxRate: li.taxRate ? (parseFloat(li.taxRate) * 100).toString() : undefined,
            showCostToCustomer: li.showCostToCustomer ?? false,
            showPriceToCustomer: li.showPriceToCustomer ?? true,
            showTaxToCustomer: li.showTaxToCustomer ?? true,
            showNotesToCustomer: li.showNotesToCustomer ?? false,
            groupId: li.groupId || undefined,
            sourceItemId: li.sourceItemId || undefined,
            sourceBundleId: li.sourceBundleId || undefined,
          })
        })
        
        if (mappedItems.length > 0) {
          setLineItems(mappedItems)
        }
      }
    } catch (error) {
      console.error('Error loading from estimate:', error)
    }
  }

  const addLineItem = () => {
    setLineItems([
      ...lineItems,
      {
        description: '',
        quantity: '1',
        unitPrice: '0',
        taxable: true,
        showCostToCustomer: false,
        showPriceToCustomer: true,
        showTaxToCustomer: true,
        showNotesToCustomer: false,
      },
    ])
  }

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index))
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
            unitPrice: '0',
            taxable: item.taxable,
            taxRate: item.taxRate?.toString() || '',
            showCostToCustomer: false,
            showPriceToCustomer: true,
            showTaxToCustomer: true,
            showNotesToCustomer: false,
            groupId,
            groupName: bundle?.name || item.name,
            isGroupHeader: true,
            sourceBundleId: bundleDefId,
          }

          const childLines: LineItem[] = components.map((comp: any) => {
            const sourceItem = comp.componentItem
            const sourceBundle = comp.componentBundle
            const sourceName = sourceItem?.name || sourceBundle?.item?.name || 'Unknown'
            const sourcePrice = sourceItem?.defaultUnitPrice 
              ? Number(sourceItem.defaultUnitPrice)
              : (sourceBundle ? Number(bundle?.item?.defaultUnitPrice || 0) : 0)
            const sourceCost = sourceItem?.defaultUnitCost 
              ? Number(sourceItem.defaultUnitCost)
              : (sourceBundle ? Number(bundle?.item?.defaultUnitCost || 0) : null)
            
            const overridePrice = comp.defaultUnitPriceOverride
              ? Number(comp.defaultUnitPriceOverride)
              : sourcePrice
            const overrideCost = comp.defaultUnitCostOverride
              ? Number(comp.defaultUnitCostOverride)
              : sourceCost

            return {
              description: sourceName,
              quantity: comp.quantity.toString(),
              unitPrice: overridePrice.toString(),
              unitCost: overrideCost?.toString() || '0',
              notes: comp.notes || '',
              vendorId: comp.vendorId || null,
              vendorName: comp.vendor?.name || null,
              taxable: sourceItem?.taxable ?? true,
              taxRate: sourceItem?.taxRate?.toString() || '',
              showCostToCustomer: false,
              showPriceToCustomer: true,
              showTaxToCustomer: true,
              showNotesToCustomer: false,
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
            unitPrice: item.defaultUnitPrice.toString(),
            unitCost: item.defaultUnitCost?.toString() || '0',
            taxable: item.taxable,
            taxRate: item.taxRate?.toString() || '',
            sourceBundleId: bundleDefId,
          }
        }
      } catch (error) {
        console.error('Error fetching bundle details:', error)
        updated[lineIndex] = {
          ...updated[lineIndex],
          description: item.name,
          quantity: '1',
          unitPrice: item.defaultUnitPrice.toString(),
          unitCost: item.defaultUnitCost?.toString() || '0',
          taxable: item.taxable,
          taxRate: item.taxRate?.toString() || '',
          sourceBundleId: item.bundleId || undefined,
        }
      }
    } else {
      updated[lineIndex] = {
        ...updated[lineIndex],
        description: item.name,
        quantity: '1',
        unitPrice: item.defaultUnitPrice.toString(),
        unitCost: item.defaultUnitCost?.toString() || '0',
        notes: item.notes || '',
        vendorId: item.vendorId || null,
        vendorName: item.vendorName || null,
        taxable: item.taxable,
        taxRate: item.taxRate?.toString() || '',
        sourceItemId: item.id,
      }
    }

    setLineItems(updated)
  }

  const handleNextLine = (currentIndex: number) => {
    const nextIndex = currentIndex + 1
    if (nextIndex >= lineItems.length) {
      addLineItem()
    }
    setTimeout(() => {
      const nextInput = lineItemRefs.current[nextIndex]?.querySelector<HTMLInputElement>('[data-picker-input="true"]')
      nextInput?.focus()
    }, 100)
  }

  const toggleVisibility = (index: number, field: 'cost' | 'price' | 'tax' | 'notes') => {
    const updated = [...lineItems]
    const fieldMap = {
      cost: 'showCostToCustomer',
      price: 'showPriceToCustomer',
      tax: 'showTaxToCustomer',
      notes: 'showNotesToCustomer',
    } as const
    
    updated[index] = {
      ...updated[index],
      [fieldMap[field]]: !updated[index][fieldMap[field]],
    }
    setLineItems(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.clientId) {
      alert('Please select a client')
      return
    }
    if (!formData.title.trim()) {
      alert('Please enter a title')
      return
    }

    setLoading(true)
    try {
      const token = localStorage.getItem('accessToken')
      
      const subtotal = lineItems.reduce((sum, item) => {
        if (item.isGroupHeader) return sum
        return sum + parseFloat(item.quantity || '0') * parseFloat(item.unitPrice || '0')
      }, 0)
      
      const discount = parseFloat(formData.discount || '0')
      const subtotalAfterDiscount = Math.max(0, subtotal - discount)
      const taxRate = parseFloat(formData.taxRate || '0') / 100
      const tax = subtotalAfterDiscount * taxRate
      const total = subtotalAfterDiscount + tax

      const apiLineItems = lineItems
        .filter(item => !item.isGroupHeader)
        .map((item, index) => ({
          description: item.description,
          quantity: parseFloat(item.quantity || '1'),
          unitPrice: parseFloat(item.unitPrice || '0'),
          unitCost: item.unitCost ? parseFloat(item.unitCost) : null,
          total: parseFloat(item.quantity || '1') * parseFloat(item.unitPrice || '0'),
          sortOrder: index,
          isVisibleToClient: true,
          showCostToCustomer: item.showCostToCustomer,
          showPriceToCustomer: item.showPriceToCustomer,
          showTaxToCustomer: item.showTaxToCustomer,
          showNotesToCustomer: item.showNotesToCustomer,
          vendorId: item.vendorId || null,
          taxable: item.taxable,
          taxRate: item.taxRate ? parseFloat(item.taxRate) / 100 : null,
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

      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId: formData.clientId,
          jobId: formData.jobId || null,
          estimateId: formData.estimateId || null,
          title: formData.title,
          subtotal,
          taxRate: taxRate,
          taxAmount: tax,
          discount,
          total,
          invoiceDate: formData.invoiceDate || new Date().toISOString().split('T')[0],
          dueDate: formData.dueDate || null,
          notes: formData.notes || null,
          isNotesVisibleToClient,
          terms: formData.terms || null,
          memo: formData.memo || null,
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
        const errorData = await response.json().catch(() => ({ error: 'Failed to create invoice' }))
        alert(errorData.error || 'Failed to create invoice')
        return
      }

      const data = await response.json()
      router.push(`/dashboard/invoices/${data.invoice.id}`)
    } catch (error) {
      console.error('Error creating invoice:', error)
      alert('Failed to create invoice. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const subtotal = lineItems.reduce((sum, item) => {
    if (item.isGroupHeader) return sum
    return sum + parseFloat(item.quantity || '0') * parseFloat(item.unitPrice || '0')
  }, 0)
  
  const discount = parseFloat(formData.discount || '0')
  const subtotalAfterDiscount = Math.max(0, subtotal - discount)
  const taxRate = parseFloat(formData.taxRate || '0') / 100
  const tax = subtotalAfterDiscount * taxRate
  const total = subtotalAfterDiscount + tax

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href="/dashboard/invoices">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">New Invoice</h1>
          <p className="mt-2 text-gray-600">Create a new invoice for a client</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Invoice Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="clientId">Client *</Label>
                  <select
                    id="clientId"
                    required
                    value={formData.clientId}
                    onChange={(e) => {
                      setFormData({ ...formData, clientId: e.target.value, jobId: '' })
                      if (e.target.value) {
                        fetchJobs()
                      }
                    }}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Select a client...</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
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
                    disabled={!formData.clientId}
                  >
                    <option value="">No job</option>
                    {jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.jobNumber} - {job.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g., Kitchen Remodel Invoice"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="invoiceDate">Invoice Date *</Label>
                    <Input
                      id="invoiceDate"
                      type="date"
                      required
                      value={formData.invoiceDate}
                      onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="dueDate">Due Date</Label>
                    <Input
                      id="dueDate"
                      type="date"
                      value={formData.dueDate}
                      onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Line Items</CardTitle>
                <CardDescription>Click in Description field to search and add items</CardDescription>
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
                        {!isGroupHeader && (
                          <div className="flex flex-col gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleVisibility(index, 'cost')}
                              title={item.showCostToCustomer ? 'Hide cost from customer' : 'Show cost to customer'}
                              className="p-1 h-6"
                            >
                              {item.showCostToCustomer ? (
                                <Eye className="h-3 w-3 text-gray-600" />
                              ) : (
                                <EyeOff className="h-3 w-3 text-gray-400" />
                              )}
                            </Button>
                          </div>
                        )}

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

                            <div className="w-28 relative">
                              <div className="flex items-center gap-1 mb-1">
                                <Label className="text-xs text-gray-500">Price</Label>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleVisibility(index, 'price')}
                                  title={item.showPriceToCustomer ? 'Hide price from customer' : 'Show price to customer'}
                                  className="p-0 h-3 w-3"
                                >
                                  {item.showPriceToCustomer ? (
                                    <Eye className="h-3 w-3 text-gray-600" />
                                  ) : (
                                    <EyeOff className="h-3 w-3 text-gray-400" />
                                  )}
                                </Button>
                              </div>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={item.unitPrice}
                                onChange={(e) => updateLineItem(index, 'unitPrice', e.target.value)}
                                required
                              />
                            </div>

                            <div className="w-28 relative">
                              <div className="flex items-center gap-1 mb-1">
                                <Label className="text-xs text-gray-500">Cost</Label>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleVisibility(index, 'cost')}
                                  title={item.showCostToCustomer ? 'Hide cost from customer' : 'Show cost to customer'}
                                  className="p-0 h-3 w-3"
                                >
                                  {item.showCostToCustomer ? (
                                    <Eye className="h-3 w-3 text-gray-600" />
                                  ) : (
                                    <EyeOff className="h-3 w-3 text-gray-400" />
                                  )}
                                </Button>
                              </div>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={item.unitCost || ''}
                                onChange={(e) => updateLineItem(index, 'unitCost', e.target.value)}
                                className="bg-gray-50"
                              />
                            </div>

                            <div className="w-24 relative">
                              <div className="flex items-center gap-1 mb-1">
                                <Label className="text-xs text-gray-500">Tax</Label>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleVisibility(index, 'tax')}
                                  title={item.showTaxToCustomer ? 'Hide tax from customer' : 'Show tax to customer'}
                                  className="p-0 h-3 w-3"
                                >
                                  {item.showTaxToCustomer ? (
                                    <Eye className="h-3 w-3 text-gray-600" />
                                  ) : (
                                    <EyeOff className="h-3 w-3 text-gray-400" />
                                  )}
                                </Button>
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={item.taxable}
                                  onChange={(e) => updateLineItem(index, 'taxable', e.target.checked)}
                                  className="h-4 w-4"
                                  title="Taxable"
                                />
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="100"
                                  placeholder="%"
                                  value={item.taxRate || ''}
                                  onChange={(e) => updateLineItem(index, 'taxRate', e.target.value)}
                                  className="text-xs w-16"
                                />
                              </div>
                            </div>
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

            <Card>
              <CardHeader>
                <CardTitle>Additional Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsNotesVisibleToClient(!isNotesVisibleToClient)}
                      title={isNotesVisibleToClient ? 'Hide from client' : 'Show to client'}
                      className="p-1"
                    >
                      {isNotesVisibleToClient ? (
                        <Eye className="h-4 w-4 text-gray-600" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-gray-400" />
                      )}
                    </Button>
                  </div>
                  <textarea
                    id="notes"
                    rows={4}
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      !isNotesVisibleToClient ? 'bg-gray-50 border-gray-200' : 'border-gray-300'
                    }`}
                  />
                </div>
                <div>
                  <Label htmlFor="terms">Terms & Conditions</Label>
                  <textarea
                    id="terms"
                    rows={4}
                    value={formData.terms}
                    onChange={(e) => setFormData({ ...formData, terms: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <Label htmlFor="memo">Memo (Internal)</Label>
                  <textarea
                    id="memo"
                    rows={3}
                    value={formData.memo}
                    onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
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
                  <Label htmlFor="discount">Discount ($)</Label>
                  <Input
                    id="discount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.discount}
                    onChange={(e) => setFormData({ ...formData, discount: e.target.value })}
                  />
                </div>
                <div className="flex justify-between">
                  <span>Subtotal after discount:</span>
                  <span>${subtotalAfterDiscount.toFixed(2)}</span>
                </div>
                <div>
                  <Label htmlFor="taxRate">Tax Rate (%)</Label>
                  <Input
                    id="taxRate"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.taxRate}
                    onChange={(e) => setFormData({ ...formData, taxRate: e.target.value })}
                  />
                </div>
                <div className="flex justify-between">
                  <span>Tax:</span>
                  <span>${tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>Total:</span>
                  <span>${total.toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col space-y-2">
              <Button type="submit" disabled={loading} className="w-full">
                <Save className="mr-2 h-4 w-4" />
                {loading ? 'Creating...' : 'Create Invoice'}
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
