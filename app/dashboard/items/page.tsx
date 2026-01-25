'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, Filter, Package, Download, Upload, Trash2, Edit, Eye } from 'lucide-react'
import Link from 'next/link'

interface Item {
  id: string
  name: string
  sku: string | null
  type: string
  kind: string
  description: string | null
  unit: string
  defaultUnitCost: number | null
  defaultUnitPrice: number
  taxable: boolean
  taxRate: number | null
  isActive: boolean
  vendor: {
    id: string
    name: string
  } | null
  category: {
    id: string
    name: string
  } | null
  tags: string[]
  updatedAt: string
}

interface ItemCategory {
  id: string
  name: string
}

const typeColors: Record<string, string> = {
  PRODUCT: 'bg-blue-100 text-blue-800',
  SERVICE: 'bg-green-100 text-green-800',
  MATERIAL: 'bg-yellow-100 text-yellow-800',
  FEE: 'bg-purple-100 text-purple-800',
}

const typeLabels: Record<string, string> = {
  PRODUCT: 'Product',
  SERVICE: 'Service',
  MATERIAL: 'Material',
  FEE: 'Fee',
}

export default function ItemsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<ItemCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    fetchItems()
    fetchCategories()
  }, [search, typeFilter, kindFilter, categoryFilter, activeFilter])

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
      const params = new URLSearchParams({
        search,
        type: typeFilter,
        kind: kindFilter,
        categoryId: categoryFilter !== 'all' ? categoryFilter : '',
        active: activeFilter !== 'all' ? activeFilter : '',
        page: '1',
        limit: '100',
      })

      const response = await fetch(`/api/items?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        console.error('Failed to fetch items:', error)
        alert(error.error || 'Failed to fetch items')
        setItems([])
        return
      }

      const data = await response.json()
      console.log('Fetched items:', data.items?.length || 0, 'items')
      setItems(data.items || [])
    } catch (error) {
      console.error('Failed to fetch items:', error)
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/items/export', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `items-export-${new Date().toISOString().split('T')[0]}.csv`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }
    } catch (error) {
      console.error('Export error:', error)
      alert('Failed to export items')
    }
  }

  const handleImport = async () => {
    if (!importFile) {
      alert('Please select a file')
      return
    }

    setImporting(true)
    try {
      const text = await importFile.text()
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/items/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ csvData: text }),
      })

      if (response.ok) {
        const data = await response.json()
        alert(`Import complete: ${data.imported} imported, ${data.skipped} skipped, ${data.errors} errors`)
        if (data.details.errors.length > 0) {
          console.error('Import errors:', data.details.errors)
        }
        fetchItems()
        setShowImportDialog(false)
        setImportFile(null)
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to import items')
      }
    } catch (error) {
      console.error('Import error:', error)
      alert('Failed to import items')
    } finally {
      setImporting(false)
    }
  }

  const handleToggleActive = async (itemId: string, currentStatus: boolean) => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/items/${itemId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !currentStatus }),
      })

      if (response.ok) {
        fetchItems()
      } else {
        alert('Failed to update item')
      }
    } catch (error) {
      console.error('Toggle active error:', error)
      alert('Failed to update item')
    }
  }

  const handleDelete = async (itemId: string, itemName: string) => {
    if (!window.confirm(`Are you sure you want to archive "${itemName}"?`)) {
      return
    }

    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/items/${itemId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.ok) {
        fetchItems()
      } else {
        alert('Failed to archive item')
      }
    } catch (error) {
      console.error('Delete error:', error)
      alert('Failed to archive item')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading items...</p>
        </div>
      </div>
    )
  }

  const activeItems = items.filter((item) => item.isActive).length
  const totalValue = items.reduce((sum, item) => sum + (item.defaultUnitPrice || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Items</h1>
          <p className="mt-2 text-gray-600">Manage your products, services, materials, and fees</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button onClick={handleExport} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button onClick={() => setShowImportDialog(true)} variant="outline">
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
          <Button onClick={() => router.push('/dashboard/items/new')} variant="outline">
            <Plus className="mr-2 h-4 w-4" />
            New Item
          </Button>
          <Button onClick={() => router.push('/dashboard/items/new?kind=bundle')}>
            <Plus className="mr-2 h-4 w-4" />
            New Bundle
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeItems}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
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
                placeholder="Search by name, SKU, or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Types</option>
                <option value="PRODUCT">Product</option>
                <option value="SERVICE">Service</option>
                <option value="MATERIAL">Material</option>
                <option value="FEE">Fee</option>
              </select>
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Kinds</option>
                <option value="SINGLE">Single Items</option>
                <option value="BUNDLE">Bundles</option>
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              <select
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Status</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Items Table */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No items</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by creating a new item or importing from CSV.
            </p>
            <div className="mt-6 flex justify-center space-x-4">
              <Button onClick={() => router.push('/dashboard/items/new')}>
                <Plus className="mr-2 h-4 w-4" />
                New Item
              </Button>
              <Button onClick={() => setShowImportDialog(true)} variant="outline">
                <Upload className="mr-2 h-4 w-4" />
                Import CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Name</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">SKU</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Type</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Unit</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-700">Unit Cost</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-700">Unit Price</th>
                    <th className="text-center py-3 px-4 font-medium text-gray-700">Taxable</th>
                    <th className="text-center py-3 px-4 font-medium text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Category</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-2">
                          <Link href={`/dashboard/items/${item.id}`} className="text-primary hover:underline font-medium">
                            {item.name}
                          </Link>
                          {item.kind === 'BUNDLE' && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-800">
                              Bundle
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-600">{item.sku || '-'}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 text-xs rounded-full ${typeColors[item.type] || 'bg-gray-100 text-gray-800'}`}>
                          {typeLabels[item.type] || item.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-600">{item.unit}</td>
                      <td className="py-3 px-4 text-right text-gray-600">
                        {item.defaultUnitCost ? formatCurrency(item.defaultUnitCost) : '-'}
                      </td>
                      <td className="py-3 px-4 text-right font-medium">{formatCurrency(item.defaultUnitPrice)}</td>
                      <td className="py-3 px-4 text-center">
                        {item.taxable ? (
                          <span className="text-green-600">Yes</span>
                        ) : (
                          <span className="text-gray-400">No</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {item.isActive ? (
                          <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Active</span>
                        ) : (
                          <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">Inactive</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-600">{item.category?.name || '-'}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end space-x-2">
                          <Link href={`/dashboard/items/${item.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Link href={`/dashboard/items/${item.id}/edit`}>
                            <Button variant="ghost" size="sm">
                              <Edit className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(item.id, item.name)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import Dialog */}
      {showImportDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Import Items from CSV</CardTitle>
              <CardDescription>
                Upload a CSV file with item data. Download the template for the correct format.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">CSV File</label>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => { setShowImportDialog(false); setImportFile(null) }}>
                  Cancel
                </Button>
                <Button onClick={handleImport} disabled={!importFile || importing}>
                  {importing ? 'Importing...' : 'Import'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
