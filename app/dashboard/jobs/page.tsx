'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, Filter, Briefcase, Calendar, DollarSign, Trash2 } from 'lucide-react'
import Link from 'next/link'

interface Job {
  id: string
  jobNumber: string
  title: string
  description: string | null
  status: string
  priority: number
  scheduledStart: string | null
  scheduledEnd: string | null
  estimateAmount: string | null
  client: {
    id: string
    name: string
    companyName: string | null
  }
  assignments: Array<{
    id: string
    role: string | null
    user: {
      id: string
      firstName: string
      lastName: string
    }
  }>
  _count: {
    tasks: number
    issues: number
  }
}

const statusColors: Record<string, string> = {
  QUOTE: 'bg-gray-100 text-gray-800',
  SCHEDULED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  ON_HOLD: 'bg-orange-100 text-orange-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
  INVOICED: 'bg-purple-100 text-purple-800',
}

const priorityLabels: Record<number, string> = {
  1: 'Low',
  2: 'Low-Medium',
  3: 'Medium',
  4: 'Medium-High',
  5: 'High',
}

export default function JobsPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetchJobs()
  }, [search, status])

  const fetchJobs = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const params = new URLSearchParams({
        search,
        status,
        page: '1',
        limit: '50',
      })

      const response = await fetch(`/api/jobs?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      const data = await response.json()
      setJobs(data.jobs || [])
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (jobId: string, jobTitle: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete job "${jobTitle}"?\n\n` +
      'This action cannot be undone. If the job has invoices, it will be cancelled instead.'
    )

    if (!confirmed) return

    setDeletingId(jobId)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/jobs/${jobId}`, {
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
        const error = await response.json()
        alert(error.error || 'Failed to delete job')
        setDeletingId(null)
        return
      }

      // Refresh the jobs list
      fetchJobs()
    } catch (error) {
      console.error('Error deleting job:', error)
      alert('Failed to delete job')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading jobs...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Jobs</h1>
          <p className="mt-2 text-gray-600">Manage your jobs and projects</p>
        </div>
        <Button onClick={() => router.push('/dashboard/jobs/new')}>
          <Plus className="mr-2 h-4 w-4" />
          New Job
        </Button>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search jobs by number, title, or description..."
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
                <option value="QUOTE">Quote</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="ON_HOLD">On Hold</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="INVOICED">Invoiced</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Jobs List */}
      <div className="space-y-4">
        {jobs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No jobs</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by creating a new job.
              </p>
              <div className="mt-6">
                <Button onClick={() => router.push('/dashboard/jobs/new')}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Job
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          jobs.map((job) => (
            <Card key={job.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <Link href={`/dashboard/jobs/${job.id}`}>
                      <CardTitle className="text-lg hover:text-primary cursor-pointer">
                        {job.title}
                      </CardTitle>
                    </Link>
                    <CardDescription className="mt-1">
                      {job.jobNumber} • {job.client.name}
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-1 text-xs rounded-full ${statusColors[job.status] || 'bg-gray-100 text-gray-800'}`}>
                      {job.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {job.description && (
                    <p className="text-sm text-gray-600 line-clamp-2">{job.description}</p>
                  )}
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    {job.scheduledStart && (
                      <div className="flex items-center text-gray-600">
                        <Calendar className="mr-2 h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Scheduled</p>
                          <p className="font-medium">{formatDate(job.scheduledStart)}</p>
                        </div>
                      </div>
                    )}
                    {job.estimateAmount && (
                      <div className="flex items-center text-gray-600">
                        <DollarSign className="mr-2 h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Estimate</p>
                          <p className="font-medium">{formatCurrency(parseFloat(job.estimateAmount))}</p>
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-gray-500">Priority</p>
                      <p className="font-medium text-gray-700">{priorityLabels[job.priority] || 'Medium'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Crew</p>
                      <p className="font-medium text-gray-700">{job.assignments.length} assigned</p>
                    </div>
                  </div>

                  {job.assignments.length > 0 && (
                    <div className="pt-2 border-t">
                      <p className="text-xs text-gray-500 mb-1">Assigned Team:</p>
                      <div className="flex flex-wrap gap-2">
                        {job.assignments.map((assignment) => (
                          <span key={assignment.id} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                            {assignment.user.firstName} {assignment.user.lastName}
                            {assignment.role && ` (${assignment.role})`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="flex items-center space-x-4 text-xs text-gray-500">
                      {job._count.tasks > 0 && (
                        <span>{job._count.tasks} tasks</span>
                      )}
                      {job._count.issues > 0 && (
                        <span>{job._count.issues} issues</span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(job.id, job.title)
                      }}
                      disabled={deletingId === job.id}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
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
