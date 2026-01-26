'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate, formatPhoneNumber } from '@/lib/utils'
import {
  Phone,
  Mail,
  MapPin,
  Building2,
  Calendar,
  FileText,
  DollarSign,
  Briefcase,
  MessageSquare,
  AlertCircle,
  CheckSquare,
  Edit,
  Plus,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { AddressMapSection } from './map-section'

interface ClientDetail {
  id: string
  name: string
  companyName: string | null
  email: string | null
  phone: string | null
  website: string | null
  tags: string[]
  isActive: boolean
  contacts: Array<{
    id: string
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
    mobile: string | null
    title: string | null
    isPrimary: boolean
  }>
  addresses: Array<{
    id: string
    type: string
    street: string
    city: string
    state: string
    zipCode: string
    country: string
  }>
  jobs: Array<{
    id: string
    jobNumber: string
    title: string
    status: string
    scheduledStart: string | null
  }>
  invoices: Array<{
    id: string
    invoiceNumber: string
    total: string
    balance: string
    status: string
    dueDate: string | null
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
  notes: Array<{
    id: string
    content: string
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
  _count: {
    jobs: number
    invoices: number
    estimates: number
    calls: number
    smsMessages: number
    emails: number
  }
}

export default function ClientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Defensive: Validate params before using
  const clientId = params?.id as string | undefined

  useEffect(() => {
    // Validate clientId exists
    if (!clientId || typeof clientId !== 'string') {
      setError('Invalid client ID')
      setLoading(false)
      return
    }

    fetchClient()
  }, [clientId, router])

  const fetchClient = async () => {
    if (!clientId) return

    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/clients/${clientId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (response.status === 404) {
        setError('Client not found')
        setLoading(false)
        return
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to load client' }))
        setError(errorData.error || 'Failed to load client')
        setLoading(false)
        return
      }

      const data = await response.json()
      // API returns client directly, not wrapped in { client: ... }
      const clientData = data.client || data
      if (!clientData || !clientData.id) {
        console.error('Invalid client data:', data)
        setError('Client not found')
        setLoading(false)
        return
      }

      // Normalize client data - ensure all arrays exist
      const normalizedClient = {
        ...clientData,
        contacts: Array.isArray(clientData.contacts) ? clientData.contacts : [],
        addresses: Array.isArray(clientData.addresses) ? clientData.addresses : [],
        jobs: Array.isArray(clientData.jobs) ? clientData.jobs : [],
        invoices: Array.isArray(clientData.invoices) ? clientData.invoices : [],
        calls: Array.isArray(clientData.calls) ? clientData.calls : [],
        smsMessages: Array.isArray(clientData.smsMessages) ? clientData.smsMessages : [],
        emails: Array.isArray(clientData.emails) ? clientData.emails : [],
        notes: Array.isArray(clientData.notes) ? clientData.notes : (Array.isArray(clientData.notes_history) ? clientData.notes_history : []),
        tasks: Array.isArray(clientData.tasks) ? clientData.tasks : [],
        issues: Array.isArray(clientData.issues) ? clientData.issues : [],
        tags: Array.isArray(clientData.tags) ? clientData.tags : [],
        _count: clientData._count || {
          jobs: 0,
          invoices: 0,
          estimates: 0,
          calls: 0,
          smsMessages: 0,
          emails: 0,
        },
      }
      setClient(normalizedClient)
      setError(null)
    } catch (error) {
      console.error('Failed to fetch client:', error)
      setError('Failed to load client. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!client) return

    if (!confirm(`Are you sure you want to delete the client "${client.name}"? This will mark the client as inactive. This action cannot be undone.`)) {
      return
    }

    setDeleting(true)
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

      // Redirect to clients list after successful deletion
      router.push('/dashboard/clients')
    } catch (error) {
      console.error('Failed to delete client:', error)
      alert('Failed to delete client. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading client...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !client) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900">Client Not Found</h2>
          <p className="mt-2 text-gray-600">{error || 'The client you are looking for does not exist.'}</p>
          <div className="mt-6">
            <Button onClick={() => router.push('/dashboard/clients')}>
              Back to Clients
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Defensive: Ensure arrays exist before using (handle null/undefined)
  const primaryContact = (client.contacts && Array.isArray(client.contacts) && client.contacts.length > 0)
    ? (client.contacts.find((c) => c.isPrimary) || client.contacts[0])
    : null
  const addresses = (client.addresses && Array.isArray(client.addresses)) ? client.addresses : []
  const jobs = (client.jobs && Array.isArray(client.jobs)) ? client.jobs : []
  const invoices = (client.invoices && Array.isArray(client.invoices)) ? client.invoices : []
  const calls = (client.calls && Array.isArray(client.calls)) ? client.calls : []
  const smsMessages = (client.smsMessages && Array.isArray(client.smsMessages)) ? client.smsMessages : []
  const emails = (client.emails && Array.isArray(client.emails)) ? client.emails : []
  // Handle both 'notes' and 'notes_history' from API
  const notes = (client.notes && Array.isArray(client.notes)) 
    ? client.notes 
    : ((client.notes_history && Array.isArray(client.notes_history)) ? client.notes_history : [])
  const tasks = (client.tasks && Array.isArray(client.tasks)) ? client.tasks : []
  const issues = (client.issues && Array.isArray(client.issues)) ? client.issues : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-3">
            <Link href="/dashboard/clients" className="text-gray-500 hover:text-gray-700">
              ← Back to Clients
            </Link>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mt-2">{client.name}</h1>
          {client.companyName && (
            <p className="text-gray-600 mt-1">{client.companyName}</p>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {client.phone && (
            <Button variant="outline" onClick={() => window.location.href = `tel:${client.phone}`}>
              <Phone className="mr-2 h-4 w-4" />
              Call
            </Button>
          )}
          <Link href={`/dashboard/clients/${clientId}/edit`}>
            <Button variant="outline">
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
          </Link>
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
            <Button variant="outline" onClick={() => router.push(`/dashboard/jobs/new?clientId=${clientId}`)}>
              <Briefcase className="mr-2 h-4 w-4" />
              New Job
            </Button>
            <Button variant="outline" onClick={() => router.push(`/dashboard/invoices/new?clientId=${clientId}`)}>
              <DollarSign className="mr-2 h-4 w-4" />
              New Invoice
            </Button>
            <Button variant="outline" onClick={() => router.push(`/dashboard/estimates/new?clientId=${clientId}`)}>
              <FileText className="mr-2 h-4 w-4" />
              New Estimate
            </Button>
            <Button variant="outline" onClick={() => router.push(`/dashboard/tasks/new?clientId=${clientId}`)}>
              <CheckSquare className="mr-2 h-4 w-4" />
              New Task
            </Button>
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
              {primaryContact && (
                <div>
                  <p className="text-sm font-medium text-gray-500">Primary Contact</p>
                  <p className="mt-1 text-lg font-semibold">
                    {primaryContact.firstName} {primaryContact.lastName}
                  </p>
                  {primaryContact.title && (
                    <p className="text-sm text-gray-600">{primaryContact.title}</p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                {client.email && (
                  <div className="flex items-center text-sm">
                    <Mail className="mr-2 h-4 w-4 text-gray-400" />
                    <a href={`mailto:${client.email}`} className="text-blue-600 hover:underline">
                      {client.email}
                    </a>
                  </div>
                )}
                {client.phone && (
                  <div className="flex items-center text-sm">
                    <Phone className="mr-2 h-4 w-4 text-gray-400" />
                    <a href={`tel:${client.phone}`} className="text-blue-600 hover:underline">
                      {formatPhoneNumber(client.phone)}
                    </a>
                  </div>
                )}
                {client.website && (
                  <div className="flex items-center text-sm">
                    <Building2 className="mr-2 h-4 w-4 text-gray-400" />
                    <a href={client.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {client.website}
                    </a>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Addresses */}
          {addresses.length > 0 && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Addresses</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {addresses.map((address) => (
                      <div key={address.id} className="border-l-4 border-blue-500 pl-4">
                        <p className="text-sm font-medium text-gray-500 capitalize">{address.type}</p>
                        <p className="mt-1 text-sm">
                          {address.street}<br />
                          {address.city}, {address.state} {address.zipCode}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Map View</CardTitle>
                </CardHeader>
                <CardContent>
                  <AddressMapSection addresses={addresses} />
                </CardContent>
              </Card>
            </>
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
                {calls.slice(0, 5).map((call) => (
                  <div key={call.id} className="flex items-start space-x-3 border-b pb-3 last:border-0">
                    <Phone className="h-5 w-5 text-blue-500 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {call.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} Call
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatPhoneNumber(call.fromNumber)} → {formatPhoneNumber(call.toNumber)}
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
                {smsMessages.slice(0, 5).map((sms) => (
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
                {emails.slice(0, 5).map((email) => (
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

                {calls.length === 0 && smsMessages.length === 0 && emails.length === 0 && (
                  <p className="text-center text-gray-500 py-8">No communication history</p>
                )}
              </div>
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
                {notes.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">No notes</p>
                ) : (
                  notes.map((note) => (
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
          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle>Statistics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Jobs</p>
                <p className="text-2xl font-bold">{client._count?.jobs || 0}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Invoices</p>
                <p className="text-2xl font-bold">{client._count?.invoices || 0}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Calls</p>
                <p className="text-2xl font-bold">{client._count?.calls || 0}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Messages</p>
                <p className="text-2xl font-bold">{client._count?.smsMessages || 0}</p>
              </div>
            </CardContent>
          </Card>

          {/* Recent Jobs */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {jobs.length === 0 ? (
                  <p className="text-sm text-gray-500">No jobs yet</p>
                ) : (
                  jobs.map((job) => (
                    <Link
                      key={job.id}
                      href={`/dashboard/jobs/${job.id}`}
                      className="block p-3 rounded-lg border hover:bg-gray-50 transition-colors"
                    >
                      <p className="text-sm font-medium">{job.jobNumber}</p>
                      <p className="text-xs text-gray-600">{job.title}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {job.status} • {job.scheduledStart ? formatDate(job.scheduledStart) : 'Not scheduled'}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Invoices */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {invoices.length === 0 ? (
                  <p className="text-sm text-gray-500">No invoices yet</p>
                ) : (
                  invoices.map((invoice) => (
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
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Tasks & Issues */}
          {(tasks.length > 0 || issues.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Tasks & Issues</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {tasks.slice(0, 3).map((task) => (
                  <Link
                    key={task.id}
                    href={`/dashboard/tasks/${task.id}`}
                    className="block p-3 rounded-lg border hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <CheckSquare className="h-4 w-4 text-blue-500" />
                      <p className="flex-1 ml-2 text-sm">{task.title}</p>
                      <span className="text-xs text-gray-500">{task.status}</span>
                    </div>
                  </Link>
                ))}
                {issues.slice(0, 3).map((issue) => (
                  <Link
                    key={issue.id}
                    href={`/dashboard/issues/${issue.id}`}
                    className="block p-3 rounded-lg border hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <p className="flex-1 ml-2 text-sm">{issue.title}</p>
                      <span className="text-xs text-gray-500">{issue.status}</span>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
