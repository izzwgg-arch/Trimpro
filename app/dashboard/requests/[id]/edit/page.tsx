'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type RequestResponse = {
  lead: {
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
    assignedToId: string | null
  }
}

interface Client {
  id: string
  name: string
  companyName: string | null
  email: string | null
  phone: string | null
}

export default function EditRequestPage() {
  const router = useRouter()
  const params = useParams()
  const requestId = params?.id as string | undefined

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<Array<{ id: string; firstName: string; lastName: string }>>([])
  const [clients, setClients] = useState<Client[]>([])
  const [clientMode, setClientMode] = useState<'new' | 'existing'>('new')
  const [clientQuery, setClientQuery] = useState('')

  const [formData, setFormData] = useState({
    clientId: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    source: 'OTHER',
    status: 'NEW',
    value: '',
    probability: '50',
    notes: '',
    jobSiteAddress: '',
    assignedToId: '',
  })

  const normalizedRequestId = useMemo(() => {
    if (!requestId || typeof requestId !== 'string') return null
    return requestId
  }, [requestId])

  useEffect(() => {
    if (!normalizedRequestId) {
      setError('Invalid request ID')
      setLoading(false)
      return
    }

    fetchUsers()
    fetchClients()
    fetchRequest()
  }, [normalizedRequestId])

  useEffect(() => {
    if (clientMode !== 'existing' || !formData.clientId || clientQuery) return
    const selectedClient = clients.find((client) => client.id === formData.clientId)
    if (selectedClient) {
      setClientQuery(getClientOptionLabel(selectedClient))
    }
  }, [clientMode, formData.clientId, clientQuery, clients])

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/schedules/team', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setUsers(data.teamMembers || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

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

  const getClientOptionLabel = (client: Client) => {
    const secondary = client.companyName || client.email || client.phone || ''
    return secondary ? `${client.name} — ${secondary}` : client.name
  }

  const fetchRequest = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const res = await fetch(`/api/leads/${normalizedRequestId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401) {
        router.push('/auth/login')
        return
      }

      if (res.status === 404) {
        setError('Request not found')
        return
      }

      if (!res.ok) {
        const text = await res.text()
        setError(text || 'Failed to load request')
        return
      }

      const data = (await res.json()) as RequestResponse
      const request = data.lead

      setFormData({
        clientId: request.convertedToClientId || '',
        firstName: request.firstName || '',
        lastName: request.lastName || '',
        email: request.email || '',
        phone: request.phone || '',
        company: request.company || '',
        source: request.source || 'OTHER',
        status: request.status || 'NEW',
        value: request.value ? parseFloat(request.value).toString() : '',
        probability: request.probability?.toString() || '50',
        notes: request.notes || '',
        jobSiteAddress: request.jobSiteAddress || '',
        assignedToId: request.assignedToId || '',
      })
      setClientMode(request.convertedToClientId ? 'existing' : 'new')
      if (request.convertedToClientId) {
        const selectedClient = clients.find((client) => client.id === request.convertedToClientId)
        if (selectedClient) {
          setClientQuery(getClientOptionLabel(selectedClient))
        }
      }
      setError(null)
    } catch (e) {
      console.error('Error loading request:', e)
      setError('Failed to load request')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!normalizedRequestId) return
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      alert('First name and last name are required')
      return
    }

    setSaving(true)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const payload = {
        clientId: clientMode === 'existing' ? formData.clientId || null : null,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone,
        company: formData.company,
        source: formData.source,
        status: formData.status,
        value: formData.value ? parseFloat(formData.value) : null,
        probability: parseInt(formData.probability),
        notes: formData.notes,
        jobSiteAddress: formData.jobSiteAddress,
        assignedToId: formData.assignedToId || null,
      }

      const res = await fetch(`/api/leads/${normalizedRequestId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (res.status === 401) {
        router.push('/auth/login')
        return
      }

      if (res.status === 404) {
        setError('Request not found')
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to update request' }))
        alert(data.error || 'Failed to update request')
        return
      }

      alert('Request updated')
      router.push(`/dashboard/requests/${normalizedRequestId}`)
    } catch (e) {
      console.error('Error updating request:', e)
      alert('Failed to update request')
    } finally {
      setSaving(false)
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

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900">Request Not Found</h2>
          <p className="mt-2 text-gray-600">{error}</p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button onClick={() => router.push('/dashboard/requests')}>Back to Requests</Button>
            {normalizedRequestId && (
              <Button variant="outline" onClick={() => router.push(`/dashboard/requests/${normalizedRequestId}`)}>
                Back to Request
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href={`/dashboard/requests/${normalizedRequestId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Edit Request</h1>
          <p className="mt-2 text-gray-600">Update this request's information</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Request Information</CardTitle>
            <CardDescription>Edit the request details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="clientMode">Client Type</Label>
                <select
                  id="clientMode"
                  value={clientMode}
                  onChange={(e) => {
                    const nextMode = e.target.value as 'new' | 'existing'
                    setClientMode(nextMode)
                    if (nextMode === 'new') {
                      setFormData((prev) => ({ ...prev, clientId: '' }))
                      setClientQuery('')
                    }
                  }}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="new">New Client</option>
                  <option value="existing">Existing Client</option>
                </select>
              </div>
            </div>

            {clientMode === 'existing' && (
              <div>
                <Label htmlFor="clientPicker">Select Client *</Label>
                <Input
                  id="clientPicker"
                  list="request-edit-client-options"
                  value={clientQuery}
                  onChange={(e) => {
                    const value = e.target.value
                    setClientQuery(value)
                    const selected = clients.find((client) => getClientOptionLabel(client) === value)
                    if (!selected) {
                      setFormData((prev) => ({ ...prev, clientId: '' }))
                      return
                    }
                    const nameParts = selected.name.trim().split(/\s+/)
                    setFormData((prev) => ({
                      ...prev,
                      clientId: selected.id,
                      firstName: nameParts[0] || '',
                      lastName: nameParts.slice(1).join(' '),
                      email: selected.email || '',
                      phone: selected.phone || '',
                      company: selected.companyName || '',
                    }))
                  }}
                  placeholder="Search and select client..."
                  required={clientMode === 'existing'}
                />
                <datalist id="request-edit-client-options">
                  {clients.map((client) => (
                    <option key={client.id} value={getClientOptionLabel(client)} />
                  ))}
                </datalist>
                <input type="hidden" value={formData.clientId} readOnly />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  required
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="John"
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  required
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder="Doe"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@example.com"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                placeholder="Company name"
              />
            </div>

            <div>
              <Label htmlFor="jobSiteAddress">Job Site Address</Label>
              <Input
                id="jobSiteAddress"
                value={formData.jobSiteAddress}
                onChange={(e) => setFormData({ ...formData, jobSiteAddress: e.target.value })}
                placeholder="123 Main St, Austin, TX 78701"
              />
              {formData.jobSiteAddress.trim() && (
                <iframe
                  title="Job Site Map"
                  className="mt-3 h-56 w-full rounded-md border"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(formData.jobSiteAddress)}&output=embed`}
                />
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="source">Source</Label>
                <select
                  id="source"
                  value={formData.source}
                  onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="OTHER">Other</option>
                  <option value="WEBSITE">Website</option>
                  <option value="REFERRAL">Referral</option>
                  <option value="SOCIAL_MEDIA">Social Media</option>
                  <option value="ADVERTISING">Advertising</option>
                  <option value="TRADE_SHOW">Trade Show</option>
                </select>
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="NEW">New</option>
                  <option value="CONTACTED">Contacted</option>
                  <option value="QUALIFIED">Qualified</option>
                  <option value="ESTIMATE_SENT">Estimate Sent</option>
                  <option value="FOLLOW_UP">Follow Up</option>
                  <option value="CONVERTED">Converted</option>
                  <option value="LOST">Lost</option>
                </select>
              </div>
              <div>
                <Label htmlFor="assignedToId">Assigned To</Label>
                <select
                  id="assignedToId"
                  value={formData.assignedToId}
                  onChange={(e) => setFormData({ ...formData, assignedToId: e.target.value })}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.firstName} {user.lastName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="value">Estimated Value ($)</Label>
                <Input
                  id="value"
                  type="number"
                  step="0.01"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label htmlFor="probability">Probability (%)</Label>
                <Input
                  id="probability"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.probability}
                  onChange={(e) => setFormData({ ...formData, probability: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                rows={4}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Additional notes about this request..."
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end space-x-4">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
