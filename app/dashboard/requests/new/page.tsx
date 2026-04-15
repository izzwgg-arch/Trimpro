'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, ExternalLink, Paperclip, Save, Trash2, Upload } from 'lucide-react'
import Link from 'next/link'
import { parseAddressParts } from '@/lib/address/parse'
import { SearchableClientSelect } from '@/components/ui/searchable-client-select'
import { fetchAllPickerClients, type PickerClient } from '@/lib/clients/fetch-all-picker-clients'
import { GoogleMapsLoader } from '@/components/maps/GoogleMapsLoader'
import { PlaceAutocompleteInput } from '@/components/maps/PlaceAutocompleteInput'

interface User {
  id: string
  firstName: string
  lastName: string
}

interface StagedAttachment {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  url: string
  key: string
  status: 'uploading' | 'uploaded' | 'failed'
  error?: string
}

export default function NewRequestPage() {
  console.log('[request-create] Component rendering - upload section should be visible')
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedClientId = searchParams.get('clientId')?.trim() || ''
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [clients, setClients] = useState<PickerClient[]>([])
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [clientMode, setClientMode] = useState<'new' | 'existing'>('existing')
  const [jobSitePlaceId, setJobSitePlaceId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [formData, setFormData] = useState({
    clientId: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    jobSiteAddress: '',
    jobSiteCity: '',
    jobSiteState: '',
    jobSiteZipCode: '',
    source: 'OTHER',
    status: 'NEW',
    value: '',
    probability: '50',
    notes: '',
    assignedToId: '',
  })

  useEffect(() => {
    fetchUsers()
    fetchClients()
  }, [])

  useEffect(() => {
    if (!preselectedClientId) return
    setClientMode('existing')
    setFormData((prev) => ({
      ...prev,
      clientId: preselectedClientId,
    }))
  }, [preselectedClientId])

  useEffect(() => {
    if (!preselectedClientId || clients.length === 0) return
    const selected = clients.find((c) => c.id === preselectedClientId)
    if (!selected) return
    const nameParts = selected.name.trim().split(/\s+/)
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ')
    setClientMode('existing')
    setFormData((prev) => ({
      ...prev,
      clientId: selected.id,
      firstName,
      lastName,
      email: selected.email || '',
      phone: selected.phone || '',
      company: selected.companyName || '',
    }))
  }, [clients, preselectedClientId])

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
      setClients(await fetchAllPickerClients())
    } catch (error) {
      console.error('Error fetching clients:', error)
    }
  }

  const handleExistingClientSelect = (clientId: string) => {
    const selected = clients.find((c) => c.id === clientId)
    if (!selected) return
    const nameParts = selected.name.trim().split(/\s+/)
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ')
    setFormData((prev) => ({
      ...prev,
      clientId: selected.id,
      firstName,
      lastName,
      email: selected.email || '',
      phone: selected.phone || '',
      company: selected.companyName || '',
    }))
  }

  const syncAddressParts = (address: string) => {
    const parsed = parseAddressParts(address)
    setFormData((prev) => ({
      ...prev,
      jobSiteAddress: address,
      jobSiteCity: parsed?.city || '',
      jobSiteState: parsed?.state || '',
      jobSiteZipCode: parsed?.zipCode || '',
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const uploadingCount = stagedAttachments.filter((a) => a.status === 'uploading').length
    if (uploadingCount > 0) {
      alert('Please wait for file uploads to finish before creating the request.')
      return
    }
    const failedCount = stagedAttachments.filter((a) => a.status === 'failed').length
    if (failedCount > 0) {
      alert('Please remove failed uploads or try uploading those files again.')
      return
    }
    if (clientMode === 'existing' && !formData.clientId) {
      alert('Please select a valid existing client from the dropdown.')
      return
    }
    if (formData.jobSiteAddress.trim() && !jobSitePlaceId) {
      alert('Please select a real job site address from the suggestions.')
      return
    }
    setLoading(true)

    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          clientId: clientMode === 'existing' ? formData.clientId || null : null,
          value: formData.value ? parseFloat(formData.value) : null,
          probability: parseInt(formData.probability),
          assignedToId: formData.assignedToId || null,
        }),
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to create request')
        return
      }

      const data = await response.json()
      if (data.lead && data.lead.id) {
        const uploadedAttachments = stagedAttachments.filter((a) => a.status === 'uploaded')
        if (uploadedAttachments.length > 0) {
          const attachErrors: string[] = []
          for (const attachment of uploadedAttachments) {
            const attachRes = await fetch('/api/attachments', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                entityType: 'request',
                entityId: data.lead.id,
                fileName: attachment.fileName,
                fileSize: attachment.fileSize,
                mimeType: attachment.mimeType,
                url: attachment.url,
                key: attachment.key,
              }),
            })
            if (!attachRes.ok) {
              const err = await attachRes.json().catch(() => ({}))
              attachErrors.push(err.error || `Failed to attach ${attachment.fileName}`)
            }
          }
          if (attachErrors.length > 0) {
            alert(`Request was created, but ${attachErrors.length} file(s) could not be attached.`)
          }
        }
        router.push(`/dashboard/requests/${data.lead.id}`)
      } else {
        alert('Request created but unable to redirect. Please refresh the page.')
        router.push('/dashboard/requests')
      }
    } catch (error) {
      console.error('Error creating request:', error)
      alert('Failed to create request')
    } finally {
      setLoading(false)
    }
  }

  const stageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    console.log('[request-create] stageFiles called with', files.length, 'files')
    setAttachmentError(null)
    const fileList = Array.from(files)
    
    // Validate file types (PDF, JPG, PNG, DOCX only)
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.docx']
    
    const invalidFiles = fileList.filter(file => {
      const type = (file.type || '').toLowerCase()
      const name = file.name.toLowerCase()
      const typeMatch = allowedTypes.some(allowed => type === allowed.toLowerCase())
      const extMatch = allowedExtensions.some(ext => name.endsWith(ext))
      return !typeMatch && !extMatch
    })
    
    if (invalidFiles.length > 0) {
      setAttachmentError(`Invalid file types. Only PDF, JPG, PNG, and DOCX files are allowed. Rejected: ${invalidFiles.map(f => f.name).join(', ')}`)
      return
    }
    
    // Validate file sizes (10MB max)
    const maxSize = 10 * 1024 * 1024 // 10MB
    const oversized = fileList.filter(file => file.size > maxSize)
    if (oversized.length > 0) {
      setAttachmentError(`Files too large (max 10MB per file). Rejected: ${oversized.map(f => f.name).join(', ')}`)
      return
    }
    
    const token = localStorage.getItem('accessToken')
    if (!token) {
      setAttachmentError('Please sign in again and retry upload.')
      return
    }
    for (const file of fileList) {
      const tempId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      setStagedAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
          url: '',
          key: '',
          status: 'uploading',
        },
      ])

      try {
        const fd = new FormData()
        fd.append('file', file)
        const upRes = await fetch('/api/uploads', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        })
        const upData = await upRes.json()
        if (!upRes.ok) {
          throw new Error(upData.error || `Upload failed for ${file.name}`)
        }
        setStagedAttachments((prev) =>
          prev.map((item) =>
            item.id === tempId
              ? {
                  ...item,
                  status: 'uploaded',
                  fileSize: upData.size || item.fileSize,
                  mimeType: upData.mimeType || item.mimeType,
                  url: upData.url,
                  key: upData.relativeUrl || upData.filename || upData.url,
                }
              : item
          )
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : `Upload failed for ${file.name}`
        setStagedAttachments((prev) =>
          prev.map((item) =>
            item.id === tempId
              ? {
                  ...item,
                  status: 'failed',
                  error: message,
                }
              : item
          )
        )
        setAttachmentError(message)
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeStagedAttachment = (id: string) => {
    setStagedAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragActive(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(false)
    void stageFiles(e.dataTransfer?.files || null)
  }

  const normalizePublicUrl = (rawUrl: string) => {
    if (!rawUrl) return rawUrl
    try {
      const parsed = new URL(rawUrl, window.location.origin)
      return parsed.toString()
    } catch {
      return rawUrl
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href="/dashboard/requests">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">New Request</h1>
          <p className="mt-2 text-gray-600">Create a new request</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Request Information</CardTitle>
            <CardDescription>Enter the request details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="clientMode">Client Type</Label>
                <Select
                  value={clientMode}
                  onValueChange={(value) => {
                    const nextMode = value as 'new' | 'existing'
                    setClientMode(nextMode)
                    if (nextMode === 'new') {
                      setFormData((prev) => ({ ...prev, clientId: '' }))
                    } else {
                      setFormData((prev) => ({ ...prev, clientId: preselectedClientId || '' }))
                    }
                  }}
                >
                  <SelectTrigger id="clientMode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New Client</SelectItem>
                    <SelectItem value="existing">Existing Client</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {clientMode === 'existing' && (
              <>
                <div>
                  <Label htmlFor="clientId">Select Client *</Label>
                  <SearchableClientSelect
                    clients={clients}
                    value={formData.clientId}
                    onSelect={handleExistingClientSelect}
                    placeholder="Select client..."
                  />
                </div>
              </>
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
              <GoogleMapsLoader>
                <PlaceAutocompleteInput
                  inputId="jobSiteAddress"
                  value={formData.jobSiteAddress}
                  onChangeText={(text) => {
                    setJobSitePlaceId(null)
                    // Keep existing parsing as a best-effort live preview, but require a selection to submit.
                    syncAddressParts(text)
                  }}
                  onAddressSelected={({ placeId, description, address }) => {
                    setJobSitePlaceId(placeId)
                    setFormData((prev) => ({
                      ...prev,
                      jobSiteAddress: description,
                      jobSiteCity: address.city || '',
                      jobSiteState: address.state || '',
                      jobSiteZipCode: address.zipCode || '',
                    }))
                  }}
                  placeholder="Start typing an address (required to select from list)"
                />
              </GoogleMapsLoader>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="jobSiteCity">City</Label>
                  <Input
                    id="jobSiteCity"
                    value={formData.jobSiteCity}
                    readOnly
                    disabled
                    placeholder="City"
                  />
                </div>
                <div>
                  <Label htmlFor="jobSiteState">State</Label>
                  <Input
                    id="jobSiteState"
                    value={formData.jobSiteState}
                    readOnly
                    disabled
                    placeholder="State"
                  />
                </div>
                <div>
                  <Label htmlFor="jobSiteZipCode">Zip Code</Label>
                  <Input
                    id="jobSiteZipCode"
                    value={formData.jobSiteZipCode}
                    readOnly
                    disabled
                    placeholder="Zip"
                  />
                </div>
              </div>
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
                <Select value={formData.source} onValueChange={(value) => setFormData({ ...formData, source: value })}>
                  <SelectTrigger id="source" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OTHER">Other</SelectItem>
                    <SelectItem value="WEBSITE">Website</SelectItem>
                    <SelectItem value="REFERRAL">Referral</SelectItem>
                    <SelectItem value="SOCIAL_MEDIA">Social Media</SelectItem>
                    <SelectItem value="ADVERTISING">Advertising</SelectItem>
                    <SelectItem value="TRADE_SHOW">Trade Show</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                  <SelectTrigger id="status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEW">New</SelectItem>
                    <SelectItem value="CONTACTED">Contacted</SelectItem>
                    <SelectItem value="QUALIFIED">Qualified</SelectItem>
                    <SelectItem value="QUOTE_SENT">Quote Sent</SelectItem>
                    <SelectItem value="CONVERTED">Converted</SelectItem>
                    <SelectItem value="LOST">Lost</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="assignedToId">Assigned To</Label>
                <Select
                  value={formData.assignedToId || '__none__'}
                  onValueChange={(value) => setFormData({ ...formData, assignedToId: value === '__none__' ? '' : value })}
                >
                  <SelectTrigger id="assignedToId" className="w-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.firstName} {user.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

            <div
              className={`space-y-3 rounded-md border-2 border-dashed p-4 transition-colors ${
                dragActive ? 'border-blue-500 bg-blue-50/40' : 'border-gray-200'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{ display: 'block' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4" />
                  <Label className="text-sm font-medium">Attachments (before save)</Label>
                </div>
                <label className="cursor-pointer">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => stageFiles(e.target.files)}
                    accept=".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Files
                  </Button>
                </label>
              </div>
              <p className="text-xs text-gray-500">Drag and drop files here, or click Upload Files.</p>

              {attachmentError && <p className="text-sm text-red-600">{attachmentError}</p>}

              {stagedAttachments.length === 0 ? (
                <p className="text-sm text-gray-500">No files uploaded yet.</p>
              ) : (
                <div className="space-y-2">
                  {stagedAttachments.map((attachment) => (
                    <div key={attachment.id} className="flex items-center justify-between rounded border p-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{attachment.fileName}</p>
                        <p className="text-xs text-gray-500">
                          {attachment.status === 'uploading' && 'Uploading...'}
                          {attachment.status === 'uploaded' && 'Uploaded'}
                          {attachment.status === 'failed' && `Failed: ${attachment.error || 'Upload failed'}`}
                        </p>
                      </div>
                      <div className="ml-3 flex items-center gap-1">
                        {attachment.status === 'uploaded' && attachment.url ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => window.open(normalizePublicUrl(attachment.url), '_blank')}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => removeStagedAttachment(attachment.id)}
                          disabled={attachment.status === 'uploading'}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-4">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading || stagedAttachments.some((attachment) => attachment.status === 'uploading')}
              >
                <Save className="mr-2 h-4 w-4" />
                {loading ? 'Creating...' : 'Create Request'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
