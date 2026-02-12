'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ArrowLeft,
  Edit,
  Phone,
  Mail,
  User,
  Building2,
  Calendar,
  DollarSign,
  TrendingUp,
  CheckCircle,
  CheckSquare,
  FileText,
  MessageSquare,
  AlertCircle,
  Plus,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'

interface RequestDetail {
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
  notes: string | null
  jobSiteAddress: string | null
  convertedToClientId: string | null
  convertedAt: string | null
  assignedTo: {
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
  } | null
  client: {
    id: string
    name: string
    companyName: string | null
  } | null
  estimates: Array<{
    id: string
    estimateNumber: string
    title: string
    total: string
    status: string
    createdAt: string
  }>
  tasks: Array<{
    id: string
    title: string
    status: string
    priority: string
    dueDate: string | null
  }>
  issues: Array<{
    id: string
    title: string
    status: string
    priority: string
  }>
  calls: Array<{
    id: string
    direction: string
    status: string
    fromNumber: string
    toNumber: string
    duration: number | null
    startedAt: string
  }>
  smsMessages: Array<{
    id: string
    direction: string
    status: string
    body: string
    sentAt: string | null
  }>
  emails: Array<{
    id: string
    direction: string
    status: string
    subject: string
    sentAt: string | null
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
  activities: Array<{
    id: string
    type: string
    description: string
    createdAt: string
    user: {
      firstName: string
      lastName: string
    }
  }>
  _count: {
    estimates: number
    tasks: number
    issues: number
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

export default function RequestDetailPage() {
  const params = useParams()
  const router = useRouter()
  const requestId = params.id as string
  const [request, setRequest] = useState<RequestDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!requestId) {
      setError('Invalid request ID')
      setLoading(false)
      return
    }
    fetchRequest()
  }, [requestId])

  const fetchRequest = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/leads/${requestId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (response.status === 404) {
        setError('Request not found')
        setLoading(false)
        return
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to load request' }))
        setError(errorData.error || 'Failed to load request')
        setLoading(false)
        return
      }

      const data = await response.json()
      setRequest(data.lead)
      setError(null)
    } catch (error) {
      console.error('Failed to fetch request:', error)
      setError('Failed to load request. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!request) return
    
    // Don't allow deleting converted requests
    if (request.convertedToClientId) {
      alert('Cannot delete a request that has been converted to a client.')
      return
    }

    if (!confirm(`Are you sure you want to delete the request for ${request.firstName} ${request.lastName}? This action cannot be undone.`)) {
      return
    }

    setDeleting(true)
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

      // Redirect to requests list after successful deletion
      router.push('/dashboard/requests')
    } catch (error) {
      console.error('Failed to delete request:', error)
      alert('Failed to delete request. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading request...</p>
        </div>
      </div>
    )
  }

  if (error || !request) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900">Request Not Found</h2>
          <p className="mt-2 text-gray-600">{error || 'The request you are looking for does not exist.'}</p>
          <div className="mt-6">
            <Button onClick={() => router.push('/dashboard/requests')}>
              Back to Requests
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const expectedValue = request.value && request.probability
    ? parseFloat(request.value) * (request.probability / 100)
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-3">
            <Link href="/dashboard/requests" className="text-gray-500 hover:text-gray-700">
              ← Back to Requests
            </Link>
          </div>
          <div className="flex items-center space-x-3 mt-2">
            <h1 className="text-3xl font-bold text-gray-900">
              {request.firstName} {request.lastName}
            </h1>
            <span className={`px-3 py-1 text-sm rounded-full ${statusColors[request.status] || 'bg-gray-100 text-gray-800'}`}>
              {request.status.replace('_', ' ')}
            </span>
            <span className={`px-3 py-1 text-sm rounded ${sourceColors[request.source] || 'bg-gray-100 text-gray-800'}`}>
              {request.source}
            </span>
          </div>
          {request.company && (
            <p className="text-gray-600 mt-1">{request.company}</p>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={() => router.push(`/dashboard/requests/${requestId}/edit`)}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          {!request.convertedToClientId && (
            <Button 
              variant="outline" 
              onClick={handleDelete}
              disabled={deleting}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button variant="outline" onClick={() => router.push(`/dashboard/estimates/new?requestId=${requestId}`)}>
              <FileText className="mr-2 h-4 w-4" />
              New Estimate
            </Button>
            <Button variant="outline" onClick={() => router.push(`/dashboard/tasks/new?requestId=${requestId}`)}>
              <CheckSquare className="mr-2 h-4 w-4" />
              New Task
            </Button>
            {request.phone && (
              <Button variant="outline" onClick={() => window.location.href = `tel:${request.phone}`}>
                <Phone className="mr-2 h-4 w-4" />
                Call
              </Button>
            )}
            {request.email && (
              <Button variant="outline" onClick={() => window.location.href = `mailto:${request.email}`}>
                <Mail className="mr-2 h-4 w-4" />
                Email
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {request.email && (
                  <div className="flex items-center text-sm">
                    <Mail className="mr-2 h-4 w-4 text-gray-400" />
                    <a href={`mailto:${request.email}`} className="text-blue-600 hover:underline">
                      {request.email}
                    </a>
                  </div>
                )}
                {request.phone && (
                  <div className="flex items-center text-sm">
                    <Phone className="mr-2 h-4 w-4 text-gray-400" />
                    <a href={`tel:${request.phone}`} className="text-blue-600 hover:underline">
                      {request.phone}
                    </a>
                  </div>
                )}
                {request.company && (
                  <div className="flex items-center text-sm">
                    <Building2 className="mr-2 h-4 w-4 text-gray-400" />
                    {request.company}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {request.jobSiteAddress && (
            <Card>
              <CardHeader>
                <CardTitle>Job Site</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700">{request.jobSiteAddress}</p>
                <iframe
                  title="Job Site Map"
                  className="mt-3 h-56 w-full rounded-md border"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(request.jobSiteAddress)}&output=embed`}
                />
              </CardContent>
            </Card>
          )}

          {/* Financial Information */}
          {(request.value || request.probability) && (
            <Card>
              <CardHeader>
                <CardTitle>Financial Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {request.value && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Estimated Value</span>
                    <span className="text-lg font-semibold">{formatCurrency(parseFloat(request.value))}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Probability</span>
                  <span className="text-lg font-medium">{request.probability}%</span>
                </div>
                {expectedValue && (
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-sm font-medium text-gray-700">Expected Value</span>
                    <span className="text-xl font-bold text-green-600">{formatCurrency(expectedValue)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {request.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{request.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Estimates */}
          {request.estimates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Estimates ({request._count.estimates})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {request.estimates.map((estimate) => (
                    <Link
                      key={estimate.id}
                      href={`/dashboard/estimates/${estimate.id}`}
                      className="block p-3 rounded-lg border hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{estimate.estimateNumber}</p>
                          <p className="text-xs text-gray-600">{estimate.title}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">{formatCurrency(parseFloat(estimate.total))}</p>
                          <span className={`text-xs px-2 py-1 rounded ${statusColors[estimate.status] || 'bg-gray-100 text-gray-800'}`}>
                            {estimate.status}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Communication Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Communication Timeline</CardTitle>
              <CardDescription>Recent calls, messages, and emails</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Recent Calls */}
                {request.calls.slice(0, 5).map((call) => (
                  <div key={call.id} className="flex items-start space-x-3 border-b pb-3 last:border-0">
                    <Phone className="h-5 w-5 text-blue-500 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {call.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} Call
                      </p>
                      <p className="text-xs text-gray-500">
                        {call.fromNumber} → {call.toNumber}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatDate(call.startedAt)} • {call.duration ? `${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}` : 'N/A'}
                      </p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded ${
                      call.status === 'ANSWERED' ? 'bg-green-100 text-green-800' :
                      call.status === 'MISSED' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {call.status}
                    </span>
                  </div>
                ))}

                {/* Recent SMS */}
                {request.smsMessages.slice(0, 5).map((sms) => (
                  <div key={sms.id} className="flex items-start space-x-3 border-b pb-3 last:border-0">
                    <MessageSquare className="h-5 w-5 text-green-500 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {sms.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} SMS
                      </p>
                      <p className="text-sm text-gray-600">{sms.body ? (sms.body.substring(0, 100) + (sms.body.length > 100 ? '...' : '')) : 'No content'}</p>
                      <p className="text-xs text-gray-400">
                        {sms.sentAt ? formatDate(sms.sentAt) : 'Pending'}
                      </p>
                    </div>
                  </div>
                ))}

                {/* Recent Emails */}
                {request.emails.slice(0, 5).map((email) => (
                  <div key={email.id} className="flex items-start space-x-3 border-b pb-3 last:border-0">
                    <Mail className="h-5 w-5 text-purple-500 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{email.subject}</p>
                      <p className="text-xs text-gray-500">
                        {email.direction === 'INBOUND' ? 'Received' : 'Sent'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {email.sentAt ? formatDate(email.sentAt) : 'Draft'}
                      </p>
                    </div>
                  </div>
                ))}

                {request.calls.length === 0 && request.smsMessages.length === 0 && request.emails.length === 0 && (
                  <p className="text-center text-gray-500 py-8">No communication history</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Activity Timeline */}
          {request.activities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Activity Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {request.activities.map((activity) => (
                    <div key={activity.id} className="flex items-start space-x-3 border-l-4 border-blue-500 pl-4">
                      <div className="flex-1">
                        <p className="text-sm text-gray-700">{activity.description}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {activity.user.firstName} {activity.user.lastName} • {formatDate(activity.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle>Statistics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Estimates</p>
                <p className="text-2xl font-bold">{request._count.estimates}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Tasks</p>
                <p className="text-2xl font-bold">{request._count.tasks}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Calls</p>
                <p className="text-2xl font-bold">{request._count.calls}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Messages</p>
                <p className="text-2xl font-bold">{request._count.smsMessages}</p>
              </div>
            </CardContent>
          </Card>

          {/* Assigned To */}
          {request.assignedTo && (
            <Card>
              <CardHeader>
                <CardTitle>Assigned To</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-3">
                  <User className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium">
                      {request.assignedTo.firstName} {request.assignedTo.lastName}
                    </p>
                    {request.assignedTo.email && (
                      <p className="text-xs text-gray-500">{request.assignedTo.email}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Converted Client */}
          {request.convertedToClientId && request.client && (
            <Card>
              <CardHeader>
                <CardTitle>Converted Client</CardTitle>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/dashboard/clients/${request.convertedToClientId}`}
                  className="flex items-center text-sm text-blue-600 hover:underline"
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  {request.client.name}
                </Link>
                {request.convertedAt && (
                  <p className="text-xs text-gray-500 mt-1">
                    Converted {formatDate(request.convertedAt)}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Recent Tasks */}
          {request.tasks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Tasks</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {request.tasks.map((task) => (
                    <Link
                      key={task.id}
                      href={`/dashboard/tasks/${task.id}`}
                      className="block p-3 rounded-lg border hover:bg-gray-50 transition-colors"
                    >
                      <p className="text-sm font-medium">{task.title}</p>
                      <p className="text-xs text-gray-500">{task.status}</p>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Issues */}
          {request.issues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Issues</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {request.issues.map((issue) => (
                    <Link
                      key={issue.id}
                      href={`/dashboard/issues/${issue.id}`}
                      className="block p-3 rounded-lg border hover:bg-gray-50 transition-colors"
                    >
                      <p className="text-sm font-medium">{issue.title}</p>
                      <p className="text-xs text-gray-500">{issue.status}</p>
                    </Link>
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
