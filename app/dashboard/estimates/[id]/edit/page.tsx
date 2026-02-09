'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Save, Plus, Trash2, Package, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { RapidFireItemPicker } from '@/components/items/RapidFireItemPicker'

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
  unitCost?: string
  isVisibleToClient?: boolean
  groupId?: string
  groupName?: string
  isGroupHeader?: boolean
  sourceItemId?: string
}

export default function EditEstimatePage() {
  const router = useRouter()
  const params = useParams()
  const estimateId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clients, setClients] = useState<Client[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [itemPickerIndex, setItemPickerIndex] = useState<number | null>(null)
  const [isNotesVisibleToClient, setIsNotesVisibleToClient] = useState(true)
  const [estimateNumber, setEstimateNumber] = useState('')
  const [formData, setFormData] = useState({
    clientId: '',
    title: '',
    taxRate: '0',
    discount: '0',
    validUntil: '',
    notes: '',
    terms: '',
    status: 'DRAFT',
  })

  useEffect(() => {
    fetchClients()
    fetchItems()
    fetchBundles()
    fetchEstimate()
  }, [estimateId])

  const fetchEstimate = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/estimates/${estimateId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        alert('Failed to load estimate')
        router.push('/dashboard/estimates')
        return
      }

      const data = await response.json()
      const est = data.estimate

      if (!est) {
        alert('Estimate not found')
        router.push('/dashboard/estimates')
        return
      }

      setEstimateNumber(est.estimateNumber)
      setIsNotesVisibleToClient(est.isNotesVisibleToClient !== false)

      const taxRatePercent = (parseFloat(est.taxRate) * 100).toString()

      setFormData({
        clientId: est.client?.id || '',
        title: est.title || '',
        taxRate: taxRatePercent,
        discount: est.discount || '0',
        validUntil: est.validUntil ? new Date(est.validUntil).toISOString().split('T')[0] : '',
        notes: est.notes || '',
        terms: est.terms || '',
        status: est.status || 'DRAFT',
      })

      const mappedItems: LineItem[] = (est.lineItems || []).map((li: any) => ({
        id: li.id,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        unitCost: li.unitCost || '',
        isVisibleToClient: li.isVisibleToClient !== false,
        groupId: li.groupId || undefined,
        sourceItemId: li.sourceItemId || undefined,
      }))

      if (mappedItems.length === 0) {
        mappedItems.push({ description: '', quantity: '1', unitPrice: '0', isVisibleToClient: true })
      }

      setLineItems(mappedItems)
    } catch (error) {
      console.error('Error fetching estimate:', error)
      alert('Failed to load estimate')
    } finally {
      setLoading(false)
    }
  }

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
    const newItem: LineItem = { description: '', quantity: '1', unitPrice: '0', isVisibleToClient: true }
    setLineItems([...lineItems, newItem])
    setTimeout(() => {
      setItemPickerIndex(lineItems.length)
      setShowItemPicker(true)
    }, 100)
  }

  const removeLineItem = (index: number) => {
    if (lineItems.length <= 1) return
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
      const groupId = `group-${Date.now()}`
      updated[index] = {
        description: selected.name,
        quantity: '1',
        unitPrice: '0',
        isVisibleToClient: true,
        groupId,
        groupName: selected.name,
        isGroupHeader: true,
        sourceItemId: (selected as Bundle).item.id,
      }
    } else {
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
    setSaving(true)

    try {
      const token = localStorage.getItem('accessToken')

      const response = await fetch(`/api/estimates/${estimateId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: formData.title,
          lineItems: lineItems.map((item) => ({
            description: item.description,
            quantity: parseFloat(item.quantity) || 0,
            unitPrice: parseFloat(item.unitPrice) || 0,
            unitCost: item.unitCost ? parseFloat(item.unitCost) : null,
            isVisibleToClient: item.isVisibleToClient ?? true,
            sourceItemId: item.sourceItemId || null,
          })),
          taxRate: formData.taxRate ? parseFloat(formData.taxRate) / 100 : 0,
          discount: formData.discount ? parseFloat(formData.discount) : 0,
          validUntil: formData.validUntil || null,
          notes: formData.notes || null,
          isNotesVisibleToClient,
          terms: formData.terms || null,
          status: formData.status,
        }),
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to update estimate')
        setSaving(false)
        return
      }

      router.push(`/dashboard/estimates/${estimateId}`)
    } catch (error) {
      console.error('Error updating estimate:', error)
      alert('Failed to update estimate. Check console for details.')
    } finally {
      setSaving(false)
    }
  }

  const calculateSubtotal = () => {
    return lineItems.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0
      const price = parseFloat(item.unitPrice) || 0
      return sum + qty * price
    }, 0)
  }

  const calculateTotalCost = () => {
    return lineItems.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0
      const cost = parseFloat(item.unitCost || '0') || 0
      return sum + qty * cost
    }, 0)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading estimate...</p>
        </div>
      </div>
    )
  }

  const subtotal = calculateSubtotal()
  const totalCost = calculateTotalCost()
  const margin = subtotal - totalCost
  const discountVal = parseFloat(formData.discount) || 0
  const taxRate = parseFloat(formData.taxRate) || 0
  const subtotalAfterDiscount = subtotal - discountVal
  const tax = subtotalAfterDiscount * (taxRate / 100)
  const total = subtotalAfterDiscount + tax

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href={`/dashboard/estimates/${estimateId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Edit Estimate</h1>
          <p className="mt-2 text-gray-600">{estimateNumber}</p>
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
                <div className="grid grid-cols-2 gap-4">
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
                    <Label htmlFor="status">Status</Label>
                    <select
                      id="status"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="SENT">Sent</option>
                      <option value="VIEWED">Viewed</option>
                      <option value="ACCEPTED">Accepted</option>
                      <option value="REJECTED">Rejected</option>
                      <option value="EXPIRED">Expired</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  </div>
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

                  <div className="flex gap-2 items-end px-2 mb-1 text-xs text-gray-500 font-medium">
                    <div className="w-8"></div>
                    <div className="flex-1">Description</div>
                    <div className="w-20 text-center">Qty</div>
                    <div className="w-28 text-center">Customer Price</div>
                    <div className="w-28 text-center">Vendor Cost</div>
                    <div className="w-20 text-right">Margin</div>
                    <div className="w-8"></div>
                  </div>

                  <div className="space-y-2">
                    {lineItems.map((item, index) => {
                      const isVisible = item.isVisibleToClient ?? true
                      const qty = parseFloat(item.quantity) || 0
                      const price = parseFloat(item.unitPrice) || 0
                      const cost = parseFloat(item.unitCost || '0') || 0
                      const lineMargin = (price - cost) * qty

                      return (
                        <div
                          key={index}
                          className={`flex gap-2 items-end p-2 rounded border transition-colors ${
                            !isVisible ? 'bg-gray-100 border-gray-200 border-dashed' : 'border-gray-300'
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
                                className={`flex-1 ${!isVisible ? 'text-gray-400' : ''}`}
                              />
                              <div className="relative">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openItemPicker(index)}
                                  title="Select from items (â†‘â†“ navigate, Enter select, â† next line)"
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
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="Cost"
                              value={item.unitCost || ''}
                              onChange={(e) => updateLineItem(index, 'unitCost', e.target.value)}
                              className="bg-gray-50"
                            />
                          </div>
                          <div className="w-20 text-right text-sm">
                            <span className={lineMargin >= 0 ? 'text-green-600' : 'text-red-600'}>
                              ${lineMargin.toFixed(2)}
                            </span>
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
                    </Button>{showItemPicker && (
  <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-24 bg-black/20">
    <div className="bg-white shadow-lg rounded-md w-[400px]">
      <RapidFireItemPicker
        isOpen={true}
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
)}
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
                      title={isNotesVisibleToClient ? 'Hide notes from client' : 'Show notes to client'}
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
                      !isNotesVisibleToClient ? 'bg-gray-50 border-gray-200 border-dashed' : 'border-gray-300'
                    }`}
                    placeholder={isNotesVisibleToClient ? 'Notes visible to client...' : 'Internal notes only (hidden from client)'}
                  />
                  {!isNotesVisibleToClient && (
                    <p className="text-xs text-gray-500 mt-1">ðŸ‘ï¸ These notes will NOT appear on the PDF or client portal.</p>
                  )}
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
            <Card className="border-2 border-blue-200 bg-blue-50/30">
              <CardHeader>
                <CardTitle className="text-sm text-blue-800">ðŸ“Š Internal Profit Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Revenue:</span>
                  <span className="font-medium">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Cost:</span>
                  <span className="font-medium text-red-600">-${totalCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold">Gross Margin:</span>
                  <span className={`font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ${margin.toFixed(2)}
                  </span>
                </div>
                {subtotal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Margin %:</span>
                    <span className={`font-medium ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {((margin / subtotal) * 100).toFixed(1)}%
                    </span>
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-2">âš ï¸ Vendor costs are never shown to the client.</p>
              </CardContent>
            </Card>

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
                  <span>After Discount:</span>
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
              <Button type="submit" disabled={saving} className="w-full">
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/dashboard/estimates/${estimateId}`)}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
