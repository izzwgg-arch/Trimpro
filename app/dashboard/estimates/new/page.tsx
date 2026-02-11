'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Save, Plus, Trash2, Package, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { RapidFireItemPicker } from '@/components/items/RapidFireItemPicker'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BUILD_TAG = 'estimates-new-2026-02-09-05'

interface Client {
  id: string
  name: string
}

interface Item {
  id: string
  name: string
  sku: string | null
  kind: string
  defaultUnitPrice: number
  defaultUnitCost: number | null
  unit: string
}

interface Bundle {
  id: string
  name: string
  item: {
    id: string
    name: string
  }
}

interface LineItem {
  id?: string
  description: string
  quantity: string
  unitPrice: string
  unitCost?: string // Vendor cost (internal)
  isVisibleToClient?: boolean // Visibility toggle
  groupId?: string
  groupName?: string
  isGroupHeader?: boolean
  sourceItemId?: string
  isTaxable?: boolean
  taxRate?: string
  vendorId?: string
  notes?: string
}

export default function NewEstimatePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientIdParam = searchParams.get('clientId')
  const [loading, setLoading] = useState(false)
  const [clients, setClients] = useState<Client[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([{ 
    description: '', 
    quantity: '1', 
    unitPrice: '0', 
    isVisibleToClient: true,
    isTaxable: true,
    taxRate: ''
  }])
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [itemPickerIndex, setItemPickerIndex] = useState<number | null>(null)
  const [isNotesVisibleToClient, setIsNotesVisibleToClient] = useState(true)
  const [formData, setFormData] = useState({
    clientId: clientIdParam || '',
    title: '',
    taxRate: '0',
    discount: '0',
    validUntil: '',
    notes: '',
    terms: '',
  })

  useEffect(() => {
    fetchClients()
    fetchItems()
    fetchBundles()
  }, [])

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

  const fetchItems = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/items?kind=SINGLE&limit=1000', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setItems(data.items || [])
      }
    } catch (error) {
      console.error('Error fetching items:', error)
    }
  }

  const fetchBundles = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/items/bundles?limit=1000', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setBundles(data.bundles || [])
      }
    } catch (error) {
      console.error('Error fetching bundles:', error)
    }
  }

  const addLineItem = () => {
    const newItem: LineItem = { 
      description: '', 
      quantity: '1', 
      unitPrice: '0', 
      isVisibleToClient: true,
      isTaxable: true,
      taxRate: '',
      id: '',
      groupId: '',
      groupName: '',
      isGroupHeader: false,
      sourceItemId: '',
      unitCost: '',
      vendorId: '',
      notes: ''
    }
    setLineItems([...lineItems, newItem])
    // Auto-open picker for new line item
    setTimeout(() => {
      setItemPickerIndex(lineItems.length)
      setShowItemPicker(true)
    }, 100)
  }

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index))
  }

  const updateLineItem = (index: number, field: keyof LineItem, value: string) => {
    const updated = [...lineItems]
    updated[index] = { ...updated[index], [field]: value }
    setLineItems(updated)
  }

  const handleItemSelect = async (selected: Item | Bundle, isBundle: boolean) => {
    const index = itemPickerIndex ?? lineItems.length - 1
    const updated = [...lineItems]

    if (isBundle) {
      // Handle bundle - this will be expanded when estimate is created
      const groupId = `group-${Date.now()}`
      updated[index] = {
        description: selected.name,
        quantity: '1',
        unitPrice: '0', // Will be calculated from bundle components
        isVisibleToClient: true,
        groupId,
        groupName: selected.name,
        isGroupHeader: true,
        sourceItemId: (selected as Bundle).item.id,
      }
    } else {
      // Handle single item
      const item = selected as Item
      updated[index] = {
        ...updated[index],
        description: item.name,
        quantity: '1',
        unitPrice: item.defaultUnitPrice.toString(),
        unitCost: item.defaultUnitCost?.toString() || '0',
        isVisibleToClient: updated[index].isVisibleToClient ?? true,
        sourceItemId: item.id,
      }
    }

    setLineItems(updated)
    setShowItemPicker(false)
    setItemPickerIndex(null)
  }

  const handleNextLine = () => {
    // Move to next line and auto-open picker
    const nextIndex = (itemPickerIndex ?? lineItems.length - 1) + 1
    if (nextIndex >= lineItems.length) {
      addLineItem()
    } else {
      setItemPickerIndex(nextIndex)
      setTimeout(() => {
        setShowItemPicker(true)
      }, 50)
    }
  }

  const openItemPicker = (index?: number) => {
    setItemPickerIndex(index ?? null)
    setShowItemPicker(true)
  }

  const toggleVisibility = (index: number) => {
    const updated = [...lineItems]
    updated[index] = {
      ...updated[index],
      isVisibleToClient: !(updated[index].isVisibleToClient ?? true),
    }
    setLineItems(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = localStorage.getItem('accessToken')
      
      // Separate bundle items from regular items
      const regularItems = lineItems.filter(item => !item.isGroupHeader)
      const bundleItems = lineItems.filter(item => item.isGroupHeader && item.sourceItemId)

      // Create estimate with regular line items first
      const response = await fetch('/api/estimates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          lineItems: regularItems.map(item => ({
            description: item.description,
            quantity: parseFloat(item.quantity) || 0,
            unitPrice: parseFloat(item.unitPrice) || 0,
            unitCost: item.unitCost ? parseFloat(item.unitCost) : null,
            isVisibleToClient: item.isVisibleToClient ?? true,
            sourceItemId: item.sourceItemId || null,
          })),
          taxRate: formData.taxRate ? parseFloat(formData.taxRate) / 100 : 0,
          discount: formData.discount ? parseFloat(formData.discount) : 0,
          isNotesVisibleToClient,
        }),
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to create estimate')
        setLoading(false)
        return
      }

      const data = await response.json()
      if (!data.estimate || !data.estimate.id) {
        alert('Estimate created but invalid response received')
        setLoading(false)
        return
      }

      // Add bundles to the estimate
      for (const bundleItem of bundleItems) {
        if (bundleItem.sourceItemId) {
          // Get the bundle definition ID from the item
          const itemResponse = await fetch(`/api/items/${bundleItem.sourceItemId}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          
          if (itemResponse.ok) {
            const itemData = await itemResponse.json()
            if (itemData.item.kind === 'BUNDLE' && itemData.item.bundleDefinition?.id) {
              // Add bundle to estimate
              const bundleResponse = await fetch(`/api/estimates/${data.estimate.id}/bundles`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  bundleId: itemData.item.bundleDefinition.id,
                }),
              })
              
              if (!bundleResponse.ok) {
                console.error('Failed to add bundle to estimate:', await bundleResponse.json())
              }
            }
          }
        }
      }

      router.push(`/dashboard/estimates/${data.estimate.id}`)
    } catch (error) {
      console.error('Error creating estimate:', error)
      alert('Failed to create estimate. Check console for details.')
    } finally {
      setLoading(false)
    }
  }

  const calculateSubtotal = () => {
    return lineItems.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0
      const price = parseFloat(item.unitPrice) || 0
      return sum + (qty * price)
    }, 0)
  }

  const subtotal = calculateSubtotal()
  const discount = parseFloat(formData.discount) || 0
  const taxRate = parseFloat(formData.taxRate) || 0
  const subtotalAfterDiscount = subtotal - discount
  const tax = subtotalAfterDiscount * (taxRate / 100)
  const total = subtotalAfterDiscount + tax

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href="/dashboard/estimates">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">New Estimate</h1>
          <p className="mt-2 text-gray-600">Create a new estimate</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Estimate Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="clientId">Client</Label>
                  <select
                    id="clientId"
                    value={formData.clientId}
                    onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a client</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
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
                    placeholder="Kitchen Remodel Estimate"
                  />
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
                    {lineItems.map((item, index) => {
                      const isVisible = item.isVisibleToClient ?? true
                      return (
                        <div
                          key={index}
                          className={`flex gap-2 items-end p-2 rounded border ${
                            !isVisible ? 'bg-gray-50 border-gray-200' : 'border-gray-300'
                          }`}
                        >
                          <div className="flex items-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleVisibility(index)}
                              title={isVisible ? 'Hide from client' : 'Show to client'}
                              className="p-1"
                            >
                              {isVisible ? (
                                <Eye className="h-4 w-4 text-gray-600" />
                              ) : (
                                <EyeOff className="h-4 w-4 text-gray-400" />
                              )}
                            </Button>
                          </div>
                          <div className="flex-1">
                            <div className="flex gap-2">
                              <Input
                                placeholder="Description"
                                value={item.description}
                                onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                                required
                                className="flex-1"
                              />
                              <div className="relative">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openItemPicker(index)}
                                  title="Select from items (or use keyboard)"
                                  className="relative"
                                >
                                  <Package className="h-4 w-4" />
                                </Button>
                                
                              </div>
                            </div>
                          </div>
                          <div className="w-20">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="Qty"
                              value={item.quantity}
                              onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
                              required
                            />
                          </div>
                          <div className="w-28">
                            <Label className="text-xs text-gray-500">Customer Price</Label>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="Price"
                              value={item.unitPrice}
                              onChange={(e) => updateLineItem(index, 'unitPrice', e.target.value)}
                              required
                            />
                          </div>
                          <div className="w-28">
                            <Label className="text-xs text-gray-500">Vendor Cost</Label>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="Cost"
                              value={item.unitCost || ''}
                              onChange={(e) => updateLineItem(index, 'unitCost', e.target.value)}
                              className="bg-gray-50"
                            />
                          </div>
                          <div className="w-28">
                            <Label className="text-xs text-gray-500">Tax</Label>
                            <div className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={item.isTaxable ?? true}
                                onChange={(e) => updateLineItem(index, 'isTaxable', e.target.checked)}
                                className="h-4 w-4"
                                title="Taxable"
                              />
                              <Input
                                type="number"
                                step="0.01"
                                placeholder="%"
                                value={item.taxRate || ''}
                                onChange={(e) => updateLineItem(index, 'taxRate', e.target.value)}
                                className="text-xs"
                              />
                            </div>
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
                      )
                    })}
                    <Button type="button" variant="outline" onClick={addLineItem}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Line Item
                    </Button>
                  </div>
                </div>
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
                  <Label htmlFor="validUntil">Valid Until</Label>
                  <Input
                    id="validUntil"
                    type="date"
                    value={formData.validUntil}
                    onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
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
                {loading ? 'Creating...' : 'Create Estimate'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()} className="w-full">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </form>

      {/* Rapid Fire Item Picker */}
      {showItemPicker && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={(e) => {
            // Only close if clicking the overlay, not the modal content
            if (e.target === e.currentTarget) {
              setShowItemPicker(false)
              setItemPickerIndex(null)
            }
          }}
        >
          <div className="w-full max-w-2xl mx-4">
            <div className="relative">
              <RapidFireItemPicker
                isOpen={showItemPicker}
                onClose={() => {
                  setShowItemPicker(false)
                  setItemPickerIndex(null)
                }}
                onSelect={handleItemSelect}
                onNextLine={handleNextLine}
                items={items}
                bundles={bundles}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
