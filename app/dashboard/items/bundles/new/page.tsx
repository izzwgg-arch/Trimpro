'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Save, Plus, X, Trash2 } from 'lucide-react'
import Link from 'next/link'

interface Vendor {
  id: string
  name: string
}

interface ItemCategory {
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

interface BundleComponent {
  componentType: 'ITEM' | 'BUNDLE'
  componentItemId?: string
  componentBundleId?: string
  quantity: string
  defaultUnitPriceOverride?: string // Customer Price
  defaultUnitCostOverride?: string // Vendor/Unit Cost
  vendorId?: string // Vendor Assignment
  notes?: string
}

export default function NewBundlePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [categories, setCategories] = useState<ItemCategory[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [components, setComponents] = useState<BundleComponent[]>([])
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [showBundlePicker, setShowBundlePicker] = useState(false)
  const [pricingStrategy, setPricingStrategy] = useState('SUM_COMPONENTS')
  const [formData, setFormData] = useState({
    name: '',
    sku: '',
    type: 'PRODUCT',
    description: '',
    categoryId: '',
    vendorId: '',
    tags: '',
    notes: '',
  })

  useEffect(() => {
    fetchVendors()
    fetchCategories()
    fetchItems()
    fetchBundles()
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

  const fetchCategories = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/items/categories', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setCategories(data.categories || [])
      }
    } catch (error) {
      console.error('Error fetching categories:', error)
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
      const response = await fetch('/api/items/bundles', {
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

  const addItemComponent = (item: Item) => {
    setComponents([
      ...components,
      {
        componentType: 'ITEM',
        componentItemId: item.id,
        quantity: '1',
      },
    ])
    setShowItemPicker(false)
  }

  const addBundleComponent = (bundle: Bundle) => {
    setComponents([
      ...components,
      {
        componentType: 'BUNDLE',
        componentBundleId: bundle.id,
        quantity: '1',
      },
    ])
    setShowBundlePicker(false)
  }

  const removeComponent = (index: number) => {
    setComponents(components.filter((_, i) => i !== index))
  }

  const updateComponent = (index: number, field: keyof BundleComponent, value: string) => {
    const updated = [...components]
    updated[index] = { ...updated[index], [field]: value }
    setComponents(updated)
  }

  const calculateTotals = () => {
    let totalCost = 0
    let totalPrice = 0

    for (const comp of components) {
      const qty = parseFloat(comp.quantity) || 0
      if (comp.componentType === 'ITEM') {
        const item = items.find((i) => i.id === comp.componentItemId)
        if (item) {
          const price = comp.defaultUnitPriceOverride
            ? parseFloat(comp.defaultUnitPriceOverride)
            : item.defaultUnitPrice
          const cost = comp.defaultUnitCostOverride
            ? parseFloat(comp.defaultUnitCostOverride)
            : item.defaultUnitCost || 0
          totalPrice += price * qty
          totalCost += cost * qty
        }
      }
      // For nested bundles, we'd need to calculate recursively
      // For now, just show a note
    }

    return { totalCost, totalPrice }
  }

  const totals = calculateTotals()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    if (components.length === 0) {
      alert('Bundle must have at least one component')
      setLoading(false)
      return
    }

    try {
      const token = localStorage.getItem('accessToken')
      const tagsArray = formData.tags
        ? formData.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : []

      const response = await fetch('/api/items/bundles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          categoryId: formData.categoryId || null,
          vendorId: formData.vendorId || null,
          tags: tagsArray,
          pricingStrategy,
          components: components.map((comp) => ({
            componentType: comp.componentType,
            componentItemId: comp.componentItemId || null,
            componentBundleId: comp.componentBundleId || null,
            quantity: parseFloat(comp.quantity) || 1,
            defaultUnitPriceOverride: comp.defaultUnitPriceOverride || null,
            defaultUnitCostOverride: comp.defaultUnitCostOverride || null,
            vendorId: comp.vendorId || null,
            notes: comp.notes || null,
          })),
        }),
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to create bundle')
        setLoading(false)
        return
      }

      const data = await response.json()
      if (!data.bundle || !data.bundle.id) {
        console.error('Invalid response data:', data)
        alert('Bundle created but invalid response received')
        setLoading(false)
        return
      }
      router.push(`/dashboard/items/${data.bundle.item.id}`)
    } catch (error) {
      console.error('Error creating bundle:', error)
      alert('Failed to create bundle. Check console for details.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href="/dashboard/items">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">New Bundle</h1>
          <p className="mt-2 text-gray-600">Create a bundle of items and/or other bundles</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Bundle name"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="sku">SKU</Label>
                    <Input
                      id="sku"
                      value={formData.sku}
                      onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                      placeholder="SKU code"
                    />
                  </div>
                  <div>
                    <Label htmlFor="type">Type *</Label>
                    <select
                      id="type"
                      required
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="PRODUCT">Product</option>
                      <option value="SERVICE">Service</option>
                      <option value="MATERIAL">Material</option>
                      <option value="FEE">Fee</option>
                    </select>
                  </div>
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="categoryId">Category</Label>
                    <select
                      id="categoryId"
                      value={formData.categoryId}
                      onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Select category</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="vendorId">Default Vendor</Label>
                    <select
                      id="vendorId"
                      value={formData.vendorId}
                      onChange={(e) => setFormData({ ...formData, vendorId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Select vendor</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <Label>Tags (comma-separated)</Label>
                  <Input
                    placeholder="tag1, tag2, tag3"
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Bundle Contents */}
            <Card>
              <CardHeader>
                <CardTitle>Bundle Contents *</CardTitle>
                <CardDescription>Add items or other bundles to this bundle</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowItemPicker(true)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Item
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowBundlePicker(true)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Bundle
                  </Button>
                </div>

                {components.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No components added yet
                  </div>
                ) : (
                  <div className="space-y-2">
                    {components.map((comp, index) => {
                      const item = comp.componentType === 'ITEM'
                        ? items.find((i) => i.id === comp.componentItemId)
                        : null
                      const bundle = comp.componentType === 'BUNDLE'
                        ? bundles.find((b) => b.id === comp.componentBundleId)
                        : null

                      return (
                        <div key={index} className="border rounded-lg p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="font-medium">
                                {comp.componentType === 'ITEM' ? item?.name : bundle?.name}
                                <span className="ml-2 text-xs text-gray-500">
                                  ({comp.componentType === 'ITEM' ? 'Item' : 'Bundle'})
                                </span>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeComponent(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label className="text-xs">Quantity</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={comp.quantity}
                                  onChange={(e) => updateComponent(index, 'quantity', e.target.value)}
                                  required
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Vendor Assignment</Label>
                                <select
                                  value={comp.vendorId || ''}
                                  onChange={(e) => updateComponent(index, 'vendorId', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                >
                                  <option value="">Select vendor</option>
                                  {vendors.map((vendor) => (
                                    <option key={vendor.id} value={vendor.id}>
                                      {vendor.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label className="text-xs">Vendor/Unit Cost</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={comp.defaultUnitCostOverride || ''}
                                  onChange={(e) => updateComponent(index, 'defaultUnitCostOverride', e.target.value)}
                                  placeholder={comp.componentType === 'ITEM' && item ? `$${item.defaultUnitCost?.toFixed(2) || '0.00'}` : 'Auto'}
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Customer Price</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={comp.defaultUnitPriceOverride || ''}
                                  onChange={(e) => updateComponent(index, 'defaultUnitPriceOverride', e.target.value)}
                                  placeholder={comp.componentType === 'ITEM' && item ? `$${item.defaultUnitPrice.toFixed(2)}` : 'Auto'}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Totals */}
                {components.length > 0 && (
                  <div className="border-t pt-4 mt-4">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">Bundle Total:</span>
                      <div className="text-right">
                        <div className="text-sm text-gray-600">
                          Cost: {totals.totalCost > 0 ? `$${totals.totalCost.toFixed(2)}` : 'N/A'}
                        </div>
                        <div className="text-lg font-semibold">
                          Price: ${totals.totalPrice.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pricing Strategy */}
            <Card>
              <CardHeader>
                <CardTitle>Pricing Strategy</CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <Label htmlFor="pricingStrategy">Pricing Method</Label>
                  <select
                    id="pricingStrategy"
                    value={pricingStrategy}
                    onChange={(e) => setPricingStrategy(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="SUM_COMPONENTS">Sum of Components (Default)</option>
                    <option value="OVERRIDE_PRICE">Override Bundle Price</option>
                  </select>
                  <p className="mt-2 text-sm text-gray-600">
                    {pricingStrategy === 'SUM_COMPONENTS'
                      ? 'Bundle price will be calculated from component prices'
                      : 'You can set a custom bundle price independent of components'}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={4}
                  placeholder="Internal notes"
                />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="flex flex-col space-y-2">
              <Button type="submit" disabled={loading || components.length === 0} className="w-full">
                <Save className="mr-2 h-4 w-4" />
                {loading ? 'Creating...' : 'Create Bundle'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()} className="w-full">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </form>

      {/* Item Picker */}
      {showItemPicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Select Item</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowItemPicker(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              <div className="space-y-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addItemComponent(item)}
                    className="w-full text-left p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="font-medium">{item.name}</div>
                    {item.sku && <div className="text-sm text-gray-500">SKU: {item.sku}</div>}
                    <div className="text-sm text-gray-600">${item.defaultUnitPrice.toFixed(2)} / {item.unit}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Bundle Picker */}
      {showBundlePicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Select Bundle</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowBundlePicker(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              <div className="space-y-2">
                {bundles.map((bundle) => (
                  <button
                    key={bundle.id}
                    onClick={() => addBundleComponent(bundle)}
                    className="w-full text-left p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="font-medium">{bundle.name}</div>
                    <div className="text-sm text-gray-500">Bundle</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
