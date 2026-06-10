'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GoogleMapsLoader } from '@/components/maps/GoogleMapsLoader'
import { PlaceAutocompleteInput } from '@/components/maps/PlaceAutocompleteInput'
import { SearchableClientSelect } from '@/components/ui/searchable-client-select'
import { fetchAllPickerClients, type PickerClient } from '@/lib/clients/fetch-all-picker-clients'

type AddressForm = {
  street: string
  city: string
  state: string
  zipCode: string
  country: string
}

type ClientResponse = {
  client: {
    id: string
    parentId: string | null
    name: string
    companyName: string | null
    email: string | null
    phone: string | null
    website: string | null
    notes: string | null
    tags: string[]
    isActive: boolean
    addresses: Array<{
      id: string
      type: string
      street: string
      city: string
      state: string
      zipCode: string
      country: string
    }>
  }
}

export default function EditClientPage() {
  const router = useRouter()
  const params = useParams()
  const clientId = params?.id as string | undefined

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [billingPlaceId, setBillingPlaceId] = useState<string | null>(null)
  const [shippingPlaceId, setShippingPlaceId] = useState<string | null>(null)
  const [availableClients, setAvailableClients] = useState<PickerClient[]>([])
  const [isSubClient, setIsSubClient] = useState(false)
  const [selectedParentId, setSelectedParentId] = useState('')

  const [formData, setFormData] = useState({
    name: '',
    companyName: '',
    email: '',
    phone: '',
    website: '',
    notes: '',
    tags: '',
    isActive: true,
    billingAddress: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'US',
    } as AddressForm,
    shippingAddress: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'US',
    } as AddressForm,
  })

  const normalizedClientId = useMemo(() => {
    if (!clientId || typeof clientId !== 'string') return null
    return clientId
  }, [clientId])

  useEffect(() => {
    if (!normalizedClientId) {
      setError('Invalid client ID')
      setLoading(false)
      return
    }

    const fetchClient = async () => {
      try {
        const token = localStorage.getItem('accessToken')
        if (!token) {
          router.push('/auth/login')
          return
        }

        const [res, availableClients] = await Promise.all([
          fetch(`/api/clients/${normalizedClientId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetchAllPickerClients(),
        ])

        if (res.status === 401) {
          router.push('/auth/login')
          return
        }

        if (res.status === 404) {
          setError('Client not found')
          return
        }

        if (!res.ok) {
          const text = await res.text()
          setError(text || 'Failed to load client')
          return
        }

        const data = (await res.json()) as ClientResponse
        const client = data.client
        const addresses = Array.isArray(client.addresses) ? client.addresses : []
        const billing = addresses.find((a) => a.type === 'billing')
        const shipping = addresses.find((a) => a.type === 'shipping')

        setFormData({
          name: client.name || '',
          companyName: client.companyName || '',
          email: client.email || '',
          phone: client.phone || '',
          website: client.website || '',
          notes: client.notes || '',
          tags: Array.isArray(client.tags) ? client.tags.join(', ') : '',
          isActive: !!client.isActive,
          billingAddress: {
            street: billing?.street || '',
            city: billing?.city || '',
            state: billing?.state || '',
            zipCode: billing?.zipCode || '',
            country: billing?.country || 'US',
          },
          shippingAddress: {
            street: shipping?.street || '',
            city: shipping?.city || '',
            state: shipping?.state || '',
            zipCode: shipping?.zipCode || '',
            country: shipping?.country || 'US',
          },
        })
        setAvailableClients(
          availableClients.filter((item) => item.id !== normalizedClientId)
        )
        setIsSubClient(Boolean(client.parentId))
        setSelectedParentId(client.parentId || '')
        setBillingPlaceId(billing?.street ? 'existing' : null)
        setShippingPlaceId(shipping?.street ? 'existing' : null)
        setError(null)
      } catch (e) {
        console.error('Error loading client:', e)
        setError('Failed to load client')
      } finally {
        setLoading(false)
      }
    }

    fetchClient()
  }, [normalizedClientId, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!normalizedClientId) return
    if (!formData.name.trim()) {
      alert('Name is required')
      return
    }
    if (formData.billingAddress.street.trim() && !billingPlaceId) {
      alert('Please select a real billing address from the suggestions.')
      return
    }
    if (isSubClient && !selectedParentId) {
      alert('Please select a parent client.')
      return
    }
    if (!isSubClient && formData.shippingAddress.street.trim() && !shippingPlaceId) {
      alert('Please select a real shipping address from the suggestions.')
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
        name: formData.name,
        companyName: formData.companyName || null,
        email: formData.email || null,
        phone: formData.phone || null,
        website: formData.website && formData.website.trim() ? formData.website.trim() : null,
        notes: formData.notes || null,
        tags: formData.tags
          ? formData.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        isActive: formData.isActive,
        parentId: isSubClient ? selectedParentId : null,
        billingAddress: formData.billingAddress.street ? formData.billingAddress : null,
        shippingAddress: isSubClient ? null : (formData.shippingAddress.street ? formData.shippingAddress : null),
      }

      const res = await fetch(`/api/clients/${normalizedClientId}`, {
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
        setError('Client not found')
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to update client' }))
        alert(data.error || 'Failed to update client')
        return
      }

      alert('Client updated')
      router.push(`/dashboard/clients/${normalizedClientId}`)
    } catch (e) {
      console.error('Error updating client:', e)
      alert('Failed to update client')
    } finally {
      setSaving(false)
    }
  }

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

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900">Client Not Found</h2>
          <p className="mt-2 text-gray-600">{error}</p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button onClick={() => router.push('/dashboard/clients')}>Back to Clients</Button>
            {normalizedClientId && (
              <Button variant="outline" onClick={() => router.push(`/dashboard/clients/${normalizedClientId}`)}>
                Back to Client
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
        <Link href={`/dashboard/clients/${normalizedClientId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Edit Client</h1>
          <p className="mt-2 text-gray-600">Update this client’s information</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Client Information</CardTitle>
            <CardDescription>Edit the client’s basic information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border p-4 space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm font-medium">
                <span>This client is a sub-client</span>
                <input
                  type="checkbox"
                  checked={isSubClient}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setIsSubClient(checked)
                    if (!checked) setSelectedParentId('')
                  }}
                />
              </label>
              {isSubClient && (
                <div className="space-y-2">
                  <Label>Parent Client</Label>
                  <SearchableClientSelect
                    clients={availableClients}
                    value={selectedParentId}
                    onSelect={setSelectedParentId}
                    placeholder="Select a parent client..."
                  />
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Doe"
              />
            </div>

            <div>
              <Label htmlFor="companyName">Company Name</Label>
              <Input
                id="companyName"
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                placeholder="Acme Corp"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="text"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@example.com, billing@example.com"
                />
                <p className="mt-1 text-xs text-gray-500">You can enter multiple emails separated by commas.</p>
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
              <Label htmlFor="website">Website (Optional)</Label>
              <Input
                id="website"
                type="url"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="https://example.com"
              />
            </div>

            <div>
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="VIP, Commercial, Residential"
              />
            </div>

            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.isActive ? 'active' : 'inactive'}
                onValueChange={(value) => setFormData({ ...formData, isActive: value === 'active' })}
              >
                <SelectTrigger id="status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                rows={4}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Additional notes about this client..."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Billing Address</CardTitle>
            <CardDescription>Primary address for billing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="billingStreet">Street Address</Label>
              <GoogleMapsLoader>
                <PlaceAutocompleteInput
                  inputId="billingStreet"
                  value={formData.billingAddress.street}
                  onChangeText={(text) => {
                    setBillingPlaceId(null)
                    setFormData((prev) => ({
                      ...prev,
                      billingAddress: { ...prev.billingAddress, street: text, city: '', state: '', zipCode: '' },
                    }))
                  }}
                  onAddressSelected={({ placeId, address }) => {
                    setBillingPlaceId(placeId)
                    setFormData((prev) => ({
                      ...prev,
                      billingAddress: {
                        ...prev.billingAddress,
                        street: address.street || prev.billingAddress.street,
                        city: address.city || '',
                        state: address.state || '',
                        zipCode: address.zipCode || '',
                        country: 'US',
                      },
                    }))
                  }}
                  placeholder="Start typing an address (required to select from list)"
                />
              </GoogleMapsLoader>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="billingCity">City</Label>
                <Input
                  id="billingCity"
                  value={formData.billingAddress.city}
                  readOnly
                  disabled
                  placeholder="City"
                />
              </div>
              <div>
                <Label htmlFor="billingState">State</Label>
                <Input
                  id="billingState"
                  value={formData.billingAddress.state}
                  readOnly
                  disabled
                  placeholder="State"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="billingZip">Zip Code</Label>
                <Input
                  id="billingZip"
                  value={formData.billingAddress.zipCode}
                  readOnly
                  disabled
                  placeholder="12345"
                />
              </div>
              <div>
                <Label htmlFor="billingCountry">Country</Label>
                <Input
                  id="billingCountry"
                  value={formData.billingAddress.country}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      billingAddress: { ...formData.billingAddress, country: e.target.value },
                    })
                  }
                  placeholder="US"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {!isSubClient && (
        <Card>
          <CardHeader>
            <CardTitle>Shipping Address (Optional)</CardTitle>
            <CardDescription>Different address for shipping if needed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="shippingStreet">Street Address</Label>
              <GoogleMapsLoader>
                <PlaceAutocompleteInput
                  inputId="shippingStreet"
                  value={formData.shippingAddress.street}
                  onChangeText={(text) => {
                    setShippingPlaceId(null)
                    setFormData((prev) => ({
                      ...prev,
                      shippingAddress: { ...prev.shippingAddress, street: text, city: '', state: '', zipCode: '' },
                    }))
                  }}
                  onAddressSelected={({ placeId, address }) => {
                    setShippingPlaceId(placeId)
                    setFormData((prev) => ({
                      ...prev,
                      shippingAddress: {
                        ...prev.shippingAddress,
                        street: address.street || prev.shippingAddress.street,
                        city: address.city || '',
                        state: address.state || '',
                        zipCode: address.zipCode || '',
                        country: 'US',
                      },
                    }))
                  }}
                  placeholder="Start typing an address (required to select from list)"
                />
              </GoogleMapsLoader>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="shippingCity">City</Label>
                <Input
                  id="shippingCity"
                  value={formData.shippingAddress.city}
                  readOnly
                  disabled
                  placeholder="City"
                />
              </div>
              <div>
                <Label htmlFor="shippingState">State</Label>
                <Input
                  id="shippingState"
                  value={formData.shippingAddress.state}
                  readOnly
                  disabled
                  placeholder="State"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="shippingZip">Zip Code</Label>
                <Input
                  id="shippingZip"
                  value={formData.shippingAddress.zipCode}
                  readOnly
                  disabled
                  placeholder="12345"
                />
              </div>
              <div>
                <Label htmlFor="shippingCountry">Country</Label>
                <Input
                  id="shippingCountry"
                  value={formData.shippingAddress.country}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      shippingAddress: { ...formData.shippingAddress, country: e.target.value },
                    })
                  }
                  placeholder="US"
                />
              </div>
            </div>
          </CardContent>
        </Card>
        )}

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

