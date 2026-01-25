'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Save } from 'lucide-react'
import Link from 'next/link'

interface Client {
  id: string
  name: string
  companyName: string | null
}

export default function NewJobPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientIdParam = searchParams.get('clientId')
  const [loading, setLoading] = useState(false)
  const [clients, setClients] = useState<Client[]>([])
  const [formData, setFormData] = useState({
    clientId: clientIdParam || '',
    title: '',
    description: '',
    status: 'QUOTE',
    priority: '3',
    scheduledStart: '',
    scheduledEnd: '',
    estimateAmount: '',
    jobSite: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'US',
      notes: '',
    },
  })

  useEffect(() => {
    fetchClients()
  }, [])

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = localStorage.getItem('accessToken')
      
      // Convert datetime-local to ISO string
      // datetime-local format is "YYYY-MM-DDTHH:mm", we need to convert to ISO 8601
      const scheduledStart = formData.scheduledStart && formData.scheduledStart.trim()
        ? (() => {
            const date = new Date(formData.scheduledStart)
            return isNaN(date.getTime()) ? null : date.toISOString()
          })()
        : null
      const scheduledEnd = formData.scheduledEnd && formData.scheduledEnd.trim()
        ? (() => {
            const date = new Date(formData.scheduledEnd)
            return isNaN(date.getTime()) ? null : date.toISOString()
          })()
        : null
      
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId: formData.clientId,
          title: formData.title,
          description: formData.description,
          status: formData.status,
          priority: parseInt(formData.priority),
          scheduledStart: scheduledStart,
          scheduledEnd: scheduledEnd,
          estimateAmount: formData.estimateAmount ? parseFloat(formData.estimateAmount) : null,
          jobSite: formData.jobSite.street ? formData.jobSite : null,
        }),
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to create job')
        return
      }

      const data = await response.json()
      if (data.job && data.job.id) {
        router.push(`/dashboard/jobs/${data.job.id}`)
      } else {
        alert('Job created but unable to redirect. Please refresh the page.')
        router.push('/dashboard/jobs')
      }
    } catch (error) {
      console.error('Error creating job:', error)
      alert('Failed to create job')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href="/dashboard/jobs">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">New Job</h1>
          <p className="mt-2 text-gray-600">Create a new job</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Job Information</CardTitle>
            <CardDescription>Enter the job details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="clientId">Client *</Label>
              <select
                id="clientId"
                required
                value={formData.clientId}
                onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name} {client.companyName ? `(${client.companyName})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="title">Job Title *</Label>
              <Input
                id="title"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Kitchen Cabinet Installation"
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                rows={4}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Job description and requirements..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="QUOTE">Quote</option>
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="ON_HOLD">On Hold</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>
              <div>
                <Label htmlFor="priority">Priority (1-5)</Label>
                <Input
                  id="priority"
                  type="number"
                  min="1"
                  max="5"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="scheduledStart">Scheduled Start</Label>
                <Input
                  id="scheduledStart"
                  type="datetime-local"
                  value={formData.scheduledStart}
                  onChange={(e) => setFormData({ ...formData, scheduledStart: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="scheduledEnd">Scheduled End</Label>
                <Input
                  id="scheduledEnd"
                  type="datetime-local"
                  value={formData.scheduledEnd}
                  onChange={(e) => setFormData({ ...formData, scheduledEnd: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="estimateAmount">Estimate Amount</Label>
              <Input
                id="estimateAmount"
                type="number"
                step="0.01"
                value={formData.estimateAmount}
                onChange={(e) => setFormData({ ...formData, estimateAmount: e.target.value })}
                placeholder="0.00"
              />
            </div>
          </CardContent>
        </Card>

        {/* Job Site Address */}
        <Card>
          <CardHeader>
            <CardTitle>Job Site Address</CardTitle>
            <CardDescription>Location where the work will be performed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="jobSiteStreet">Street Address</Label>
              <Input
                id="jobSiteStreet"
                value={formData.jobSite.street}
                onChange={(e) => setFormData({
                  ...formData,
                  jobSite: { ...formData.jobSite, street: e.target.value }
                })}
                placeholder="123 Main St"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="jobSiteCity">City</Label>
                <Input
                  id="jobSiteCity"
                  value={formData.jobSite.city}
                  onChange={(e) => setFormData({
                    ...formData,
                    jobSite: { ...formData.jobSite, city: e.target.value }
                  })}
                  placeholder="City"
                />
              </div>
              <div>
                <Label htmlFor="jobSiteState">State</Label>
                <Input
                  id="jobSiteState"
                  value={formData.jobSite.state}
                  onChange={(e) => setFormData({
                    ...formData,
                    jobSite: { ...formData.jobSite, state: e.target.value }
                  })}
                  placeholder="State"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="jobSiteZip">Zip Code</Label>
                <Input
                  id="jobSiteZip"
                  value={formData.jobSite.zipCode}
                  onChange={(e) => setFormData({
                    ...formData,
                    jobSite: { ...formData.jobSite, zipCode: e.target.value }
                  })}
                  placeholder="12345"
                />
              </div>
              <div>
                <Label htmlFor="jobSiteCountry">Country</Label>
                <Input
                  id="jobSiteCountry"
                  value={formData.jobSite.country}
                  onChange={(e) => setFormData({
                    ...formData,
                    jobSite: { ...formData.jobSite, country: e.target.value }
                  })}
                  placeholder="US"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="jobSiteNotes">Location Notes</Label>
              <textarea
                id="jobSiteNotes"
                rows={2}
                value={formData.jobSite.notes}
                onChange={(e) => setFormData({
                  ...formData,
                  jobSite: { ...formData.jobSite, notes: e.target.value }
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Special instructions or landmarks..."
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end space-x-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            <Save className="mr-2 h-4 w-4" />
            {loading ? 'Creating...' : 'Create Job'}
          </Button>
        </div>
      </form>
    </div>
  )
}
