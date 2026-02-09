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

interface Client {
  id: string
  name: string
}

interface LineItem {
  id?: string
  description: string
  quantity: string
  unitPrice: string
  groupId?: string
  groupName?: string
  isGroupHeader?: boolean
  sourceItemId?: string
}

export default function NewInvoicePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientIdParam = searchParams.get('clientId')
  const jobIdParam = searchParams.get('jobId')
  const [loading, setLoading] = useState(false)
  const [clients, setClients] = useState<Client[]>([])
  const [jobs, setJobs] = useState<any[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', quantity: '1', unitPrice: '0' }])
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [itemPickerIndex, setItemPickerIndex] = useState<number | null>(null)
  const [formData, setFormData] = useState({
    clientId: clientIdParam || '',
    jobId: jobIdParam || '',
    title: '',
    taxRate: '0',
    discount: '0',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    notes: '',
    terms: '',
    memo: '',
  })

  useEffect(() => {
    fetchClients()
    if (formData.clientId) {
      fetchJobs()
    }
  }, [formData.clientId])

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

  const handleItemSelect = async (item: any) => {
    if (item.kind === 'BUNDLE') {
      // Handle bundle - this will be expanded when invoice is created
      const groupId = `group-${Date.now()}`
      const updated = [...lineItems]
      updated.push({
        description: item.name,
        quantity: '1',
        unitPrice: item.defaultUnitPrice.toString(),
        groupId,
        groupName: item.name,
        isGroupHeader: true,
        sourceItemId: item.id,
      })
      setLineItems(updated)
      setShowItemPicker(false)
      setItemPickerIndex(null)
      alert('Bundle selected. Bundle will be expanded when invoice is saved.')
    } else {
      // Handle single item
      const index = itemPickerIndex ?? lineItems.length - 1
      const updated = [...lineItems]
      updated[index] = {
        description: item.name + (item.description ? ` - ${item.description}` : ''),
        quantity: '1',
        unitPrice: item.defaultUnitPrice.toString(),
        sourceItemId: item.id,
      }
      setLineItems(updated)
    setShowItemPicker(false)
    setItemPickerIndex(null)
    
    // Auto-focus next line item row after selection
    setTimeout(() => {
      const nextIndex = index + (isBundle ? updated.length - index : 1)
      if (nextIndex >= updated.length) {
        // Add new line item and auto-open picker
        const newItem: LineItem = { description: '', quantity: '1', unitPrice: '0', isVisibleToClient: true }
        setLineItems([...updated, newItem])
        setTimeout(() => {
          setItemPickerIndex(updated.length)
          setShowItemPicker(true)
        }, 100)
      } else {
        // Focus existing next line and auto-open picker
        setItemPickerIndex(nextIndex)
        setTimeout(() => {
          setShowItemPicker(true)
        }, 100)
      }
    }, 150)
  }
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
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          lineItems: lineItems.map(item => ({
            description: item.description,
            quantity: parseFloat(item.quantity) || 0,
            unitPrice: parseFloat(item.unitPrice) || 0,
          })),
          taxRate: formData.taxRate ? parseFloat(formData.taxRate) / 100 : 0,
          discount: formData.discount ? parseFloat(formData.discount) : 0,
        }),
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to create invoice')
        return
      }

      const data = await response.json()
      if (!data.invoice || !data.invoice.id) {
        alert('Invoice created but invalid response received')
        setLoading(false)
        return
      }

      // Add bundles to the invoice
      const bundleItems = lineItems.filter(item => item.isGroupHeader && item.sourceItemId)
      for (const bundleItem of bundleItems) {
        if (bundleItem.sourceItemId) {
          // Get the bundle definition ID from the item
          const itemResponse = await fetch(`/api/items/${bundleItem.sourceItemId}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          
          if (itemResponse.ok) {
            const itemData = await itemResponse.json()
            if (itemData.item.kind === 'BUNDLE' && itemData.item.bundleDefinition?.id) {
              // Add bundle to invoice
              const bundleResponse = await fetch(`/api/invoices/${data.invoice.id}/bundles`, {
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
                console.error('Failed to add bundle to invoice:', await bundleResponse.json())
              }
            }
          }
        }
      }

      router.push(`/dashboard/invoices/${data.invoice.id}`)
    } catch (error) {
      console.error('Error creating estimate:', error)
      alert('Failed to create estimate')
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
        <Link href="/dashboard/invoices">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">New Invoice</h1>
          <p className="mt-2 text-gray-600">Create a new invoice</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Invoice Information</CardTitle>
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

            <Card>
              <CardHeader>
                <CardTitle>Additional Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <textarea
                    id="notes"
                    rows={4}
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <div>
                  <Label htmlFor="jobId">Job (Optional)</Label>
                  <select
                    id="jobId"
                    value={formData.jobId}
                    onChange={(e) => setFormData({ ...formData, jobId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={!formData.clientId}
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
                  <Label htmlFor="memo">Memo</Label>
                  <Input
                    id="memo"
                    value={formData.memo}
                    onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                    placeholder="Internal memo"
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


