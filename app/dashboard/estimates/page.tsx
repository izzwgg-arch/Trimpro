'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, Filter, FileText, Calendar, Trash2, Briefcase, Copy } from 'lucide-react'
import Link from 'next/link'

interface Estimate {
  id: string
  estimateNumber: string
  title: string
  status: string
  total: string
  validUntil: string | null
  sentAt: string | null
  acceptedAt: string | null
  client: {
    id: string
    name: string
    companyName: string | null
  } | null
  lead: {
    id: string
    firstName: string
    lastName: string
  } | null
  job: {
    id: string
    jobNumber: string
  } | null
  _count: {
    lineItems: number
  }
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SENT: 'bg-blue-100 text-blue-800',
  VIEWED: 'bg-purple-100 text-purple-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-orange-100 text-orange-800',
  CONVERTED: 'bg-indigo-100 text-indigo-800',
}

export default function EstimatesPage() {
  const router = useRouter()
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    fetchEstimates()
  }, [search, status])

  const fetchEstimates = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const params = new URLSearchParams({
        search,
        status,
        page: '1',
        limit: '50',
      })

      const response = await fetch(`/api/estimates?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      const data = await response.json()
      setEstimates(data.estimates || [])
    } catch (error) {
      console.error('Failed to fetch estimates:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (estimate: Estimate) => {
    if (!confirm(`Delete estimate "${estimate.estimateNumber}"?`)) return

    setDeletingId(estimate.id)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/estimates/${estimate.id}`, {
        method: 'DELETE',
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
        alert(data.error || 'Failed to delete estimate')
        return
      }

      fetchEstimates()
    } catch (error) {
      console.error('Failed to delete estimate:', error)
      alert('Failed to delete estimate')
    } finally {
      setDeletingId(null)
    }
  }

  const handleConvertToJob = async (estimate: Estimate) => {
    if (estimate.job) {
      router.push(`/dashboard/jobs/${estimate.job.id}`)
      return
    }
    if (!confirm(`Convert estimate "${estimate.estimateNumber}" into a job?`)) return

    setConvertingId(estimate.id)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/estimates/${estimate.id}/convert-to-job`, {
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
        alert(data.error || 'Failed to convert estimate to job')
        return
      }

      const jobId = data?.job?.id
      if (jobId) {
        router.push(`/dashboard/jobs/${jobId}`)
      } else {
        fetchEstimates()
      }
    } catch (error) {
      console.error('Failed to convert estimate:', error)
      alert('Failed to convert estimate to job')
    } finally {
      setConvertingId(null)
    }
  }

  const handleDuplicateSelected = async () => {
    if (selectedIds.length === 0) return
    if (!confirm(`Duplicate ${selectedIds.length} selected estimate(s)?`)) return

    setDuplicating(true)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      for (const estimateId of selectedIds) {
        const response = await fetch(`/api/estimates/${estimateId}/duplicate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          alert(data.error || 'Failed to duplicate one or more estimates')
          break
        }
      }

      setSelectedIds([])
      fetchEstimates()
    } catch (error) {
      console.error('Failed duplicating estimates:', error)
      alert('Failed to duplicate selected estimates')
    } finally {
      setDuplicating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading estimates...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Estimates</h1>
          <p className="mt-2 text-gray-600">Create and manage estimates</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => router.push('/dashboard/estimates/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Estimate
          </Button>
          <Button
            variant="outline"
            onClick={handleDuplicateSelected}
            disabled={selectedIds.length === 0 || duplicating}
          >
            <Copy className="mr-2 h-4 w-4" />
            {duplicating ? 'Duplicating...' : `Duplicate${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search estimates by number or title..."
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
                <option value="DRAFT">Draft</option>
                <option value="SENT">Sent</option>
                <option value="VIEWED">Viewed</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="REJECTED">Rejected</option>
                <option value="EXPIRED">Expired</option>
                <option value="CONVERTED">Converted</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Estimates List */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {estimates.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No estimates</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by creating a new estimate.
            </p>
            <div className="mt-6">
              <Button onClick={() => router.push('/dashboard/estimates/new')}>
                <Plus className="mr-2 h-4 w-4" />
                New Estimate
              </Button>
            </div>
          </div>
        ) : (
          estimates.map((estimate) => (
            <Card key={estimate.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <Link href={`/dashboard/estimates/${estimate.id}`}>
                      <CardTitle className="text-lg hover:text-primary cursor-pointer">
                        {estimate.title}
                      </CardTitle>
                    </Link>
                    <CardDescription className="mt-1">
                      {estimate.estimateNumber}
                      {estimate.client && ` • ${estimate.client.name}`}
                      {estimate.lead && ` • ${estimate.lead.firstName} ${estimate.lead.lastName}`}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(estimate.id)}
                      onChange={(e) =>
                        setSelectedIds((prev) =>
                          e.target.checked
                            ? [...prev, estimate.id]
                            : prev.filter((id) => id !== estimate.id)
                        )
                      }
                      className="h-4 w-4"
                      title="Select for duplicate"
                    />
                    <span className={`px-2 py-1 text-xs rounded-full ${statusColors[estimate.status] || 'bg-gray-100 text-gray-800'}`}>
                      {estimate.status}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Total</span>
                    <span className="text-lg font-bold">{formatCurrency(parseFloat(estimate.total))}</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {estimate.validUntil && (
                      <div className="flex items-center text-gray-600">
                        <Calendar className="mr-2 h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Valid Until</p>
                          <p className="font-medium">{formatDate(estimate.validUntil)}</p>
                        </div>
                      </div>
                    )}
                    {estimate.sentAt && (
                      <div>
                        <p className="text-xs text-gray-500">Sent</p>
                        <p className="font-medium text-gray-700">{formatDate(estimate.sentAt)}</p>
                      </div>
                    )}
                  </div>

                  {estimate.job && (
                    <div className="pt-2 border-t">
                      <Link href={`/dashboard/jobs/${estimate.job.id}`} className="text-sm text-primary hover:underline">
                        Linked to Job {estimate.job.jobNumber}
                      </Link>
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-1 pt-2 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleConvertToJob(estimate)
                      }}
                      disabled={convertingId === estimate.id}
                      className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-7 px-2"
                      title={estimate.job ? 'Open Job' : 'Convert to Job'}
                    >
                      <Briefcase className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(estimate)
                      }}
                      disabled={deletingId === estimate.id}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                      title="Delete Estimate"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
