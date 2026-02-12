'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import { Plus, Search, Phone, Mail, Building2, Filter, Trash2 } from 'lucide-react'
import Link from 'next/link'

interface Client {
  id: string
  parentId?: string | null
  name: string
  companyName: string | null
  email: string | null
  phone: string | null
  isActive: boolean
  contacts: Array<{
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
    title: string | null
    isPrimary: boolean
  }>
  _count: {
    jobs: number
    invoices: number
  }
  parent?: {
    id: string
    name: string
  } | null
}

export default function ClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetchClients()
  }, [search, status])

  const fetchClients = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const params = new URLSearchParams({
        search,
        status,
        page: '1',
        limit: '50',
      })

      const response = await fetch(`/api/clients?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      const data = await response.json()
      setClients(data.clients || [])
    } catch (error) {
      console.error('Failed to fetch clients:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (clientId: string, clientName: string) => {
    if (!confirm(`Are you sure you want to permanently delete the client "${clientName}"? This action cannot be undone.`)) {
      return
    }

    setDeletingId(clientId)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/clients/${clientId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to delete client' }))
        alert(errorData.error || 'Failed to delete client')
        return
      }

      // Refresh the list
      fetchClients()
    } catch (error) {
      console.error('Failed to delete client:', error)
      alert('Failed to delete client. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading clients...</p>
        </div>
      </div>
    )
  }

  const flattenedClients = useMemo(() => {
    const byParent = new Map<string, Client[]>()
    const allIds = new Set(clients.map((c) => c.id))
    const roots: Client[] = []

    for (const client of clients) {
      if (client.parentId && allIds.has(client.parentId)) {
        const list = byParent.get(client.parentId) || []
        list.push(client)
        byParent.set(client.parentId, list)
      } else {
        roots.push(client)
      }
    }

    const sortByName = (a: Client, b: Client) => a.name.localeCompare(b.name)
    roots.sort(sortByName)
    byParent.forEach((list) => list.sort(sortByName))

    const output: Array<{ client: Client; isSubClient: boolean }> = []
    const visit = (client: Client) => {
      output.push({ client, isSubClient: false })
      const children = byParent.get(client.id) || []
      for (const child of children) {
        output.push({ client: child, isSubClient: true })
      }
    }

    for (const root of roots) visit(root)
    return output
  }, [clients])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
          <p className="mt-2 text-gray-600">Manage your clients and contacts</p>
        </div>
        <Button onClick={() => router.push('/dashboard/clients/new')}>
          <Plus className="mr-2 h-4 w-4" />
          New Client
        </Button>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search clients by name, email, or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Clients</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Clients List */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {clients.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <Building2 className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No clients</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by creating a new client.
            </p>
            <div className="mt-6">
              <Button onClick={() => router.push('/dashboard/clients/new')}>
                <Plus className="mr-2 h-4 w-4" />
                New Client
              </Button>
            </div>
          </div>
        ) : (
          flattenedClients.map(({ client, isSubClient }) => {
            const primaryContact = client.contacts.find((c) => c.isPrimary) || client.contacts[0]
            return (
              <Card key={client.id} className={`hover:shadow-lg transition-shadow ${isSubClient ? 'ml-4 border-l-4 border-blue-300' : ''}`}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <Link href={`/dashboard/clients/${client.id}`}>
                        <CardTitle className="text-lg hover:text-primary cursor-pointer">
                          {client.name}
                        </CardTitle>
                      </Link>
                      {isSubClient && (
                        <div className="mt-1">
                          <span className="inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800">
                            Sub-client
                          </span>
                          {client.parent?.name && (
                            <span className="ml-2 text-xs text-gray-500">Parent: {client.parent.name}</span>
                          )}
                        </div>
                      )}
                      {client.companyName && (
                        <CardDescription className="mt-1">{client.companyName}</CardDescription>
                      )}
                    </div>
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        client.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {client.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {primaryContact && (
                      <div className="text-sm text-gray-600">
                        <p className="font-medium">
                          {primaryContact.firstName} {primaryContact.lastName}
                        </p>
                        {primaryContact.title && (
                          <p className="text-xs text-gray-500">{primaryContact.title}</p>
                        )}
                      </div>
                    )}
                    <div className="space-y-1">
                      {client.phone && (
                        <div className="flex items-center text-sm text-gray-600">
                          <Phone className="mr-2 h-3 w-3" />
                          {client.phone}
                        </div>
                      )}
                      {client.email && (
                        <div className="flex items-center text-sm text-gray-600">
                          <Mail className="mr-2 h-3 w-3" />
                          {client.email}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex items-center space-x-3 text-xs text-gray-500">
                        <span>{client._count.jobs} jobs</span>
                        <span>{client._count.invoices} invoices</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(client.id, client.name)
                        }}
                        disabled={deletingId === client.id}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
