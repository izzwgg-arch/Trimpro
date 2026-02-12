'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, Filter, User, Phone, Mail, TrendingUp, CheckCircle, Trash2, FileText } from 'lucide-react'
import Link from 'next/link'

interface Request {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  company: string | null
  source: string
  status: string
  value: string | null
  probability: number
  convertedToClientId: string | null
  convertedAt: string | null
  assignedTo: {
    id: string
    firstName: string
    lastName: string
  } | null
  client: {
    id: string
    name: string
  } | null
  _count: {
    estimates: number
    calls: number
    smsMessages: number
    emails: number
  }
}

const statusColors: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  CONTACTED: 'bg-yellow-100 text-yellow-800',
  QUALIFIED: 'bg-green-100 text-green-800',
  ESTIMATE_SENT: 'bg-purple-100 text-purple-800',
  FOLLOW_UP: 'bg-orange-100 text-orange-800',
  CONVERTED: 'bg-indigo-100 text-indigo-800',
  LOST: 'bg-red-100 text-red-800',
}

const sourceColors: Record<string, string> = {
  WEBSITE: 'bg-blue-100 text-blue-800',
  REFERRAL: 'bg-green-100 text-green-800',
  PHONE: 'bg-purple-100 text-purple-800',
  EMAIL: 'bg-yellow-100 text-yellow-800',
  SOCIAL_MEDIA: 'bg-pink-100 text-pink-800',
  OTHER: 'bg-gray-100 text-gray-800',
}

export default function RequestsPage() {
  const router = useRouter()
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [source, setSource] = useState('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)

  useEffect(() => {
    fetchRequests()
  }, [search, status, source])

  const fetchRequests = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const params = new URLSearchParams({
        search,
        status,
        source,
        page: '1',
        limit: '50',
      })

      const response = await fetch(`/api/leads?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      const data = await response.json()
      setRequests(data.leads || [])
    } catch (error) {
      console.error('Failed to fetch requests:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (requestId: string, requestName: string) => {
    if (!confirm(`Are you sure you want to delete the request for ${requestName}? This action cannot be undone.`)) {
      return
    }

    setDeletingId(requestId)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/leads/${requestId}`, {
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
        const errorData = await response.json().catch(() => ({ error: 'Failed to delete request' }))
        alert(errorData.error || 'Failed to delete request')
        return
      }

      // Refresh the list
      fetchRequests()
    } catch (error) {
      console.error('Failed to delete request:', error)
      alert('Failed to delete request. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  const handleConvertToEstimate = async (request: Request) => {
    const requestName = `${request.firstName} ${request.lastName}`.trim()
    if (!confirm(`Convert request "${requestName}" into an estimate?`)) return

    setConvertingId(request.id)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/leads/${request.id}/convert-to-estimate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(data.error || 'Failed to convert request to estimate')
        return
      }

      const estimateId = data?.estimate?.id
      if (estimateId) {
        router.push(`/dashboard/estimates/${estimateId}`)
      } else {
        fetchRequests()
      }
    } catch (error) {
      console.error('Failed to convert request:', error)
      alert('Failed to convert request to estimate. Please try again.')
    } finally {
      setConvertingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading requests...</p>
        </div>
      </div>
    )
  }

  const pipelineStats = {
    new: requests.filter((r) => r.status === 'NEW').length,
    contacted: requests.filter((r) => r.status === 'CONTACTED').length,
    qualified: requests.filter((r) => r.status === 'QUALIFIED').length,
    converted: requests.filter((r) => r.status === 'CONVERTED').length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Requests</h1>
          <p className="mt-2 text-gray-600">Manage your sales pipeline</p>
        </div>
        <Button onClick={() => router.push('/dashboard/requests/new')}>
          <Plus className="mr-2 h-4 w-4" />
          New Request
        </Button>
      </div>

      {/* Pipeline Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">New</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pipelineStats.new}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Contacted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pipelineStats.contacted}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Qualified</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pipelineStats.qualified}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Converted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{pipelineStats.converted}</div>
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
                placeholder="Search requests by name, email, or phone..."
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
                <option value="all">All Status</option>
                <option value="NEW">New</option>
                <option value="CONTACTED">Contacted</option>
                <option value="QUALIFIED">Qualified</option>
                <option value="ESTIMATE_SENT">Estimate Sent</option>
                <option value="FOLLOW_UP">Follow Up</option>
                <option value="CONVERTED">Converted</option>
                <option value="LOST">Lost</option>
              </select>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Sources</option>
                <option value="WEBSITE">Website</option>
                <option value="REFERRAL">Referral</option>
                <option value="PHONE">Phone</option>
                <option value="EMAIL">Email</option>
                <option value="SOCIAL_MEDIA">Social Media</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Requests List */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {requests.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <User className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No requests</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by creating a new request.
            </p>
            <div className="mt-6">
              <Button onClick={() => router.push('/dashboard/requests/new')}>
                <Plus className="mr-2 h-4 w-4" />
                New Request
              </Button>
            </div>
          </div>
        ) : (
          requests.map((request) => {
            const expectedValue = request.value && request.probability
              ? parseFloat(request.value) * (request.probability / 100)
              : null

            return (
              <Card key={request.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <Link href={`/dashboard/requests/${request.id}`}>
                        <CardTitle className="text-lg hover:text-primary cursor-pointer">
                          {request.firstName} {request.lastName}
                        </CardTitle>
                      </Link>
                      {request.company && (
                        <CardDescription className="mt-1">{request.company}</CardDescription>
                      )}
                    </div>
                    <div className="flex flex-col items-end space-y-1">
                      <span className={`px-2 py-1 text-xs rounded-full ${statusColors[request.status] || 'bg-gray-100 text-gray-800'}`}>
                        {request.status.replace('_', ' ')}
                      </span>
                      <span className={`px-2 py-1 text-xs rounded ${sourceColors[request.source] || 'bg-gray-100 text-gray-800'}`}>
                        {request.source}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      {request.email && (
                        <div className="flex items-center text-sm text-gray-600">
                          <Mail className="mr-2 h-3 w-3" />
                          {request.email}
                        </div>
                      )}
                      {request.phone && (
                        <div className="flex items-center text-sm text-gray-600">
                          <Phone className="mr-2 h-3 w-3" />
                          {request.phone}
                        </div>
                      )}
                    </div>

                    {request.assignedTo && (
                      <div className="flex items-center text-sm text-gray-600">
                        <User className="mr-2 h-3 w-3" />
                        {request.assignedTo.firstName} {request.assignedTo.lastName}
                      </div>
                    )}

                    {(request.value || request.probability) && (
                      <div className="pt-2 border-t">
                        {request.value && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Value</span>
                            <span className="font-semibold">{formatCurrency(parseFloat(request.value))}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-sm mt-1">
                          <span className="text-gray-500">Probability</span>
                          <span className="font-medium">{request.probability}%</span>
                        </div>
                        {expectedValue && (
                          <div className="flex items-center justify-between text-sm mt-1">
                            <span className="text-gray-500">Expected Value</span>
                            <span className="font-bold text-green-600">{formatCurrency(expectedValue)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {request.convertedToClientId && (
                      <div className="pt-2 border-t">
                        <Link
                          href={`/dashboard/clients/${request.convertedToClientId}`}
                          className="flex items-center text-sm text-blue-600 hover:underline"
                        >
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Converted to Client
                        </Link>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex items-center space-x-3 text-xs text-gray-500">
                        {request._count.estimates > 0 && <span>{request._count.estimates} estimates</span>}
                        {request._count.calls > 0 && <span>{request._count.calls} calls</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleConvertToEstimate(request)
                          }}
                          disabled={convertingId === request.id}
                          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-7 px-2"
                          title="Convert to Estimate"
                        >
                          <FileText className="h-3 w-3" />
                        </Button>
                        {!request.convertedToClientId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(request.id, `${request.firstName} ${request.lastName}`)
                            }}
                            disabled={deletingId === request.id}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                            title="Delete Request"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
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
