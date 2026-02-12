'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import {
  Briefcase,
  Calendar,
  DollarSign,
  Users,
  MapPin,
  FileText,
  CheckSquare,
  AlertCircle,
  Phone,
  MessageSquare,
  Mail,
  Edit,
  Plus,
  Building2,
  Trash2,
  Copy,
} from 'lucide-react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { GoogleMapsLoader } from '@/components/maps/GoogleMapsLoader'

const JobSiteMap = dynamic(() => import('@/components/maps/JobSiteMap').then(mod => ({ default: mod.JobSiteMap })), {
  ssr: false,
  loading: () => <div className="p-4 bg-gray-50 rounded-lg text-center text-gray-600">Loading map...</div>
})

interface JobDetail {
  id: string
  jobNumber: string
  title: string
  description: string | null
  status: string
  priority: number
  scheduledStart: string | null
  scheduledEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  estimateAmount: string | null
  actualAmount: string | null
  laborCost: string | null
  materialCost: string | null
  client: {
    id: string
    name: string
    companyName: string | null
    contacts: Array<{
      id: string
      firstName: string
      lastName: string
      phone: string | null
      email: string | null
    }>
  }
  jobSite: {
    id: string
    street: string
    city: string
    state: string
    zipCode: string
    country: string
  } | null
  assignments: Array<{
    id: string
    role: string | null
    notes: string | null
    user: {
      id: string
      firstName: string
      lastName: string
      email: string
      phone: string | null
    }
  }>
  tasks: Array<{
    id: string
    title: string
    status: string
    priority: string
    dueDate: string | null
    assignee: {
      firstName: string
      lastName: string
    }
  }>
  issues: Array<{
    id: string
    title: string
    status: string
    priority: string
  }>
  invoices: Array<{
    id: string
    invoiceNumber: string
    total: string
    balance: string
    status: string
  }>
  notes: Array<{
    id: string
    content: string
    createdAt: string
  }>
  schedules: Array<{
    id: string
    startTime: string
    endTime: string
    user: {
      firstName: string
      lastName: string
    }
  }>
  _count: {
    tasks: number
    issues: number
    invoices: number
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

export default function JobDetailPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.id as string
  const [job, setJob] = useState<JobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [convertingToInvoice, setConvertingToInvoice] = useState(false)
  const [duplicating, setDuplicating] = useState(false)

  useEffect(() => {
    fetchJob()
  }, [jobId])

  const fetchJob = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/jobs/${jobId}`, {
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
        console.error('Failed to fetch job:', error)
        setJob(null)
        setLoading(false)
        return
      }

      const data = await response.json()
      if (data.job) {
        setJob(data.job)
      } else {
        setJob(null)
      }
    } catch (error) {
      console.error('Failed to fetch job:', error)
      setJob(null)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!job) return

    const confirmed = window.confirm(
      `Are you sure you want to delete job "${job.title}"?\n\n` +
      (job._count.invoices > 0
        ? 'This job has invoices and cannot be deleted. It will be cancelled instead.'
        : 'This action cannot be undone.')
    )

    if (!confirmed) return

    setDeleting(true)
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
        setDeleting(false)
        return
      }

      // Redirect to jobs list after successful deletion
      router.push('/dashboard/jobs')
    } catch (error) {
      console.error('Error deleting job:', error)
      alert('Failed to delete job')
      setDeleting(false)
    }
  }

  const handleConvertToInvoice = async () => {
    if (!job) return
    if (!confirm(`Convert job "${job.jobNumber}" to an invoice?`)) return

    setConvertingToInvoice(true)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/jobs/${jobId}/convert-to-invoice`, {
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
        alert(data.error || 'Failed to convert job to invoice')
        return
      }

      const invoiceId = data?.invoice?.id
      if (invoiceId) {
        router.push(`/dashboard/invoices/${invoiceId}`)
      } else {
        fetchJob()
      }
    } catch (error) {
      console.error('Error converting job to invoice:', error)
      alert('Failed to convert job to invoice')
    } finally {
      setConvertingToInvoice(false)
    }
  }

  const handleDuplicate = async () => {
    setDuplicating(true)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/jobs/${jobId}/duplicate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(data.error || 'Failed to duplicate job')
        return
      }

      if (data?.id) {
        router.push(`/dashboard/jobs/${data.id}`)
      } else {
        router.push('/dashboard/jobs')
      }
    } catch (error) {
      console.error('Duplicate job error:', error)
      alert('Failed to duplicate job')
    } finally {
      setDuplicating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading job...</p>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 text-xl font-semibold mb-2">Job not found</div>
        <p className="text-gray-600 mb-4">The job you're looking for doesn't exist or you don't have permission to view it.</p>
        <Button variant="outline" onClick={() => router.push('/dashboard/jobs')}>
          ← Back to Jobs
        </Button>
      </div>
    )
  }

  const primaryContact = job.client.contacts?.[0] || null
  const profit = job.actualAmount && job.actualAmount && job.laborCost && job.materialCost
    ? parseFloat(job.actualAmount) - parseFloat(job.laborCost) - parseFloat(job.materialCost)
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-3">
            <Link href="/dashboard/jobs" className="text-gray-500 hover:text-gray-700">
              ← Back to Jobs
            </Link>
          </div>
          <div className="flex items-center space-x-3 mt-2">
            <h1 className="text-3xl font-bold text-gray-900">{job.title}</h1>
            <span className={`px-3 py-1 text-sm rounded-full ${statusColors[job.status] || 'bg-gray-100 text-gray-800'}`}>
              {job.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-gray-600 mt-1">
            {job.jobNumber} • <Link href={`/dashboard/clients/${job.client.id}`} className="text-primary hover:underline">{job.client.name}</Link>
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button onClick={handleConvertToInvoice} disabled={convertingToInvoice}>
            <DollarSign className="mr-2 h-4 w-4" />
            {convertingToInvoice ? 'Converting...' : 'Convert to Invoice'}
          </Button>
          <Button variant="outline" onClick={handleDuplicate} disabled={duplicating}>
            <Copy className="mr-2 h-4 w-4" />
            {duplicating ? 'Duplicating...' : 'Duplicate'}
          </Button>
          <Button variant="outline" onClick={() => router.push(`/dashboard/jobs/${jobId}/edit`)}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button 
            variant="outline" 
            onClick={handleDelete}
            disabled={deleting}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button
              variant="outline"
              onClick={() =>
                router.push(
                  `/dashboard/tasks/new?jobId=${jobId}&clientId=${job.client.id}&jobNumber=${encodeURIComponent(job.jobNumber)}&clientName=${encodeURIComponent(job.client.name)}&projectType=${encodeURIComponent(job.title)}`
                )
              }
            >
              <CheckSquare className="mr-2 h-4 w-4" />
              New Task
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                router.push(
                  `/dashboard/issues/new?jobId=${jobId}&clientId=${job.client.id}&jobNumber=${encodeURIComponent(job.jobNumber)}&clientName=${encodeURIComponent(job.client.name)}&projectType=${encodeURIComponent(job.title)}`
                )
              }
            >
              <AlertCircle className="mr-2 h-4 w-4" />
              New Issue
            </Button>
            <Button variant="outline" onClick={() => router.push(`/dashboard/invoices/new?jobId=${jobId}`)}>
              <DollarSign className="mr-2 h-4 w-4" />
              New Invoice
            </Button>
            <Button variant="outline" onClick={() => router.push(`/dashboard/schedule/new?jobId=${jobId}`)}>
              <Calendar className="mr-2 h-4 w-4" />
              Schedule
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Job Information */}
          <Card>
            <CardHeader>
              <CardTitle>Job Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {job.description && (
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">Description</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{job.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {job.scheduledStart && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Scheduled Start</p>
                    <p className="text-sm font-semibold mt-1">{formatDateTime(job.scheduledStart)}</p>
                  </div>
                )}
                {job.scheduledEnd && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Scheduled End</p>
                    <p className="text-sm font-semibold mt-1">{formatDateTime(job.scheduledEnd)}</p>
                  </div>
                )}
                {job.actualStart && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Actual Start</p>
                    <p className="text-sm font-semibold mt-1">{formatDateTime(job.actualStart)}</p>
                  </div>
                )}
                {job.actualEnd && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Actual End</p>
                    <p className="text-sm font-semibold mt-1">{formatDateTime(job.actualEnd)}</p>
                  </div>
                )}
              </div>

              {/* Financials */}
              {(job.estimateAmount || job.actualAmount) && (
                <div className="pt-4 border-t">
                  <p className="text-sm font-medium text-gray-500 mb-3">Financials</p>
                  <div className="grid grid-cols-2 gap-4">
                    {job.estimateAmount && (
                      <div>
                        <p className="text-xs text-gray-500">Estimate</p>
                        <p className="text-lg font-semibold">{formatCurrency(parseFloat(job.estimateAmount))}</p>
                      </div>
                    )}
                    {job.actualAmount && (
                      <div>
                        <p className="text-xs text-gray-500">Actual</p>
                        <p className="text-lg font-semibold">{formatCurrency(parseFloat(job.actualAmount))}</p>
                      </div>
                    )}
                    {job.laborCost && (
                      <div>
                        <p className="text-xs text-gray-500">Labor Cost</p>
                        <p className="text-sm font-medium">{formatCurrency(parseFloat(job.laborCost))}</p>
                      </div>
                    )}
                    {job.materialCost && (
                      <div>
                        <p className="text-xs text-gray-500">Material Cost</p>
                        <p className="text-sm font-medium">{formatCurrency(parseFloat(job.materialCost))}</p>
                      </div>
                    )}
                    {profit !== null && (
                      <div>
                        <p className="text-xs text-gray-500">Profit</p>
                        <p className={`text-sm font-semibold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(profit)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Job Site */}
          {job.jobSite && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Job Site</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start space-x-3">
                    <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm">
                        {job.jobSite.street}<br />
                        {job.jobSite.city}, {job.jobSite.state} {job.jobSite.zipCode}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Map View</CardTitle>
                </CardHeader>
                <CardContent>
                  <GoogleMapsLoader>
                    <JobSiteMap
                      address={{
                        street: job.jobSite.street,
                        city: job.jobSite.city,
                        state: job.jobSite.state,
                        zipCode: job.jobSite.zipCode,
                        country: job.jobSite.country || 'USA',
                      }}
                      jobTitle={job.title}
                    />
                  </GoogleMapsLoader>
                </CardContent>
              </Card>
            </>
          )}

          {/* Crew Assignments */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Crew Assignments</CardTitle>
                <Button variant="outline" size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Crew
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {job.assignments.length === 0 ? (
                <p className="text-center text-gray-500 py-4">No crew assigned</p>
              ) : (
                <div className="space-y-3">
                  {job.assignments.map((assignment) => (
                    <div key={assignment.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">
                          {assignment.user.firstName} {assignment.user.lastName}
                        </p>
                        {assignment.role && (
                          <p className="text-sm text-gray-500">{assignment.role}</p>
                        )}
                        {assignment.notes && (
                          <p className="text-xs text-gray-600 mt-1">{assignment.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {assignment.user.phone && (
                          <Button variant="ghost" size="sm">
                            <Phone className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm">
                          <Mail className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Notes</CardTitle>
                <Button variant="outline" size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Note
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {job.notes.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">No notes</p>
                ) : (
                  job.notes.map((note) => (
                    <div key={note.id} className="border-l-4 border-gray-300 pl-4">
                      <p className="text-sm text-gray-700">{note.content}</p>
                      <p className="text-xs text-gray-400 mt-1">{formatDate(note.createdAt)}</p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Client Info */}
          <Card>
            <CardHeader>
              <CardTitle>Client</CardTitle>
            </CardHeader>
            <CardContent>
              <Link href={`/dashboard/clients/${job.client.id}`} className="hover:text-primary">
                <p className="font-semibold">{job.client.name}</p>
                {job.client.companyName && (
                  <p className="text-sm text-gray-600">{job.client.companyName}</p>
                )}
              </Link>
              {primaryContact ? (
                <div className="mt-3 space-y-2">
                  {primaryContact.phone && (
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <Phone className="mr-2 h-4 w-4" />
                      {primaryContact.phone}
                    </Button>
                  )}
                  {primaryContact.email && (
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <Mail className="mr-2 h-4 w-4" />
                      Email
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 mt-3">No contact information available</p>
              )}
            </CardContent>
          </Card>

          {/* Tasks & Issues */}
          <Card>
            <CardHeader>
              <CardTitle>Tasks & Issues</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-2">Tasks ({job._count.tasks})</p>
                {job.tasks.length === 0 ? (
                  <p className="text-sm text-gray-500">No tasks</p>
                ) : (
                  job.tasks.slice(0, 5).map((task) => (
                    <Link
                      key={task.id}
                      href={`/dashboard/tasks/${task.id}`}
                      className="block p-2 rounded border hover:bg-gray-50 transition-colors mb-2"
                    >
                      <div className="flex items-center justify-between">
                        <CheckSquare className="h-4 w-4 text-blue-500" />
                        <p className="flex-1 ml-2 text-sm">{task.title}</p>
                        <span className="text-xs text-gray-500">{task.status}</span>
                      </div>
                    </Link>
                  ))
                )}
              </div>
              <div className="pt-3 border-t">
                <p className="text-xs text-gray-500 mb-2">Issues ({job._count.issues})</p>
                {job.issues.length === 0 ? (
                  <p className="text-sm text-gray-500">No issues</p>
                ) : (
                  job.issues.slice(0, 5).map((issue) => (
                    <Link
                      key={issue.id}
                      href={`/dashboard/issues/${issue.id}`}
                      className="block p-2 rounded border hover:bg-gray-50 transition-colors mb-2"
                    >
                      <div className="flex items-center justify-between">
                        <AlertCircle className="h-4 w-4 text-red-500" />
                        <p className="flex-1 ml-2 text-sm">{issue.title}</p>
                        <span className="text-xs text-gray-500">{issue.status}</span>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Invoices */}
          {job.invoices.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Invoices</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {job.invoices.map((invoice) => (
                    <Link
                      key={invoice.id}
                      href={`/dashboard/invoices/${invoice.id}`}
                      className="block p-3 rounded-lg border hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{invoice.invoiceNumber}</p>
                          <p className="text-xs text-gray-600">{formatCurrency(parseFloat(invoice.total))}</p>
                        </div>
                        <span className={`px-2 py-1 text-xs rounded ${
                          invoice.status === 'PAID' ? 'bg-green-100 text-green-800' :
                          invoice.status === 'OVERDUE' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {invoice.status}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Schedule */}
          {job.schedules.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Schedule</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {job.schedules.map((schedule) => (
                    <div key={schedule.id} className="p-3 rounded-lg border">
                      <p className="text-sm font-medium">
                        {formatDate(schedule.startTime)}
                      </p>
                      <p className="text-xs text-gray-600">
                        {schedule.user.firstName} {schedule.user.lastName}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
