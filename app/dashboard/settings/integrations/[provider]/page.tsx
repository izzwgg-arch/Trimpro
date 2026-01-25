'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatDate } from '@/lib/utils'
import {
  ArrowLeft,
  Save,
  TestTube,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
} from 'lucide-react'
import Link from 'next/link'
import { getIntegration, IntegrationProvider } from '@/lib/integrations/registry'
import { SecretField } from '@/components/integrations/SecretField'

const statusColors: Record<string, string> = {
  NOT_CONFIGURED: 'bg-gray-100 text-gray-800',
  CONNECTED: 'bg-green-100 text-green-800',
  ERROR: 'bg-red-100 text-red-800',
  CONNECTING: 'bg-yellow-100 text-yellow-800',
}

export default function IntegrationProviderPage() {
  const router = useRouter()
  const params = useParams()
  const provider = (params.provider as IntegrationProvider) || 'email'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [integration, setIntegration] = useState<any>(null)
  const [connection, setConnection] = useState<any>(null)
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; error?: string } | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [webhookSecret, setWebhookSecret] = useState<string>('')

  useEffect(() => {
    fetchIntegration()
    fetchConnection()
  }, [provider])

  const fetchIntegration = () => {
    const int = getIntegration(provider)
    setIntegration(int)
    // Initialize form data with default values based on config fields
    const initialData: Record<string, any> = {}
    if (int.configFields) {
      int.configFields.forEach((field) => {
        if (field.type === 'select' && field.options && field.options.length > 0) {
          initialData[field.key] = field.options[0].value
        } else {
          initialData[field.key] = ''
        }
      })
    }
    setFormData(initialData)
  }

  const refreshToken = async (): Promise<boolean> => {
    const refreshToken = localStorage.getItem('refreshToken')
    if (!refreshToken) {
      router.push('/auth/login')
      return false
    }

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })

      if (response.ok) {
        const data = await response.json()
        localStorage.setItem('accessToken', data.accessToken)
        localStorage.setItem('refreshToken', data.refreshToken)
        return true
      } else {
        router.push('/auth/login')
        return false
      }
    } catch (error) {
      router.push('/auth/login')
      return false
    }
  }

  const fetchConnection = async () => {
    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      let response = await fetch(`/api/integrations/${provider}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        // Token expired, try to refresh
        const refreshed = await refreshToken()
        if (!refreshed) return

        // Retry with new token
        token = localStorage.getItem('accessToken')
        response = await fetch(`/api/integrations/${provider}`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (response.status === 401) {
          router.push('/auth/login')
          return
        }
      }

      if (response.ok) {
        const data = await response.json()
        setConnection(data)

        // Populate form with masked secrets (except webhookSecret which we handle separately)
        if (data.maskedSecrets) {
          const { webhookSecret: secret, ...otherSecrets } = data.maskedSecrets
          setFormData((prev) => ({
            ...prev,
            ...otherSecrets,
          }))
          // Fetch the actual webhook secret (unmasked) if it exists
          if (secret && secret !== '••••••') {
            // If masked, we need to fetch the actual value
            // For now, we'll need to decrypt it from the connection
            // This is a temporary workaround - ideally we'd have a separate endpoint
          }
        }
        // Fetch the actual secret value (unmasked for webhook secrets)
        if (provider === 'voipms_sms' && data.secret) {
          setWebhookSecret(data.secret)
        }
      }
    } catch (error) {
      console.error('Failed to fetch connection:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setTestResult(null)

    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
      }

      let response = await fetch(`/api/integrations/${provider}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          displayName: integration?.name,
          secrets: formData,
          metadata: {},
        }),
      })

      if (response.status === 401) {
        // Token expired, try to refresh
        const refreshed = await refreshToken()
        if (!refreshed) return

        // Retry with new token
        token = localStorage.getItem('accessToken')
        response = await fetch(`/api/integrations/${provider}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            displayName: integration?.name,
            secrets: formData,
            metadata: {},
          }),
        })
      }

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to save integration')
        return
      }

      alert('Integration saved successfully!')
      fetchConnection()
    } catch (error) {
      console.error('Failed to save integration:', error)
      alert('Failed to save integration')
    } finally {
      setSaving(false)
    }
  }

  const handleConnectQuickBooks = async () => {
    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
      }

      let response = await fetch('/api/integrations/quickbooks/connect', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      })

      if (response.status === 401) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
        response = await fetch('/api/integrations/quickbooks/connect', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        })
      }

      if (response.ok) {
        const data = await response.json()
        // Redirect to QuickBooks OAuth URL
        window.location.href = data.authUrl
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to connect to QuickBooks')
      }
    } catch (error) {
      console.error('Failed to connect QuickBooks:', error)
      alert('Failed to connect to QuickBooks. Please try again.')
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)

    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
      }

      const body: any = {}

      // Add test parameters based on provider
      if (provider === 'voipms_sms' || provider === 'whatsapp') {
        if (!testPhone) {
          alert('Please enter a phone number to test')
          setTesting(false)
          return
        }
        body.to = testPhone
        body.message = 'Trim Pro test message'
      } else if (provider === 'email') {
        body.to = testEmail
      }

      let response = await fetch(`/api/integrations/${provider}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })

      if (response.status === 401) {
        // Token expired, try to refresh
        const refreshed = await refreshToken()
        if (!refreshed) return

        // Retry with new token
        token = localStorage.getItem('accessToken')
        response = await fetch(`/api/integrations/${provider}/test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        })
      }

      const result = await response.json()
      setTestResult(result)

      if (result.success) {
        fetchConnection()
      }
    } catch (error) {
      console.error('Failed to test integration:', error)
      setTestResult({
        success: false,
        message: 'Test failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setTesting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect this integration?')) {
      return
    }

    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
      }

      let response = await fetch(`/api/integrations/${provider}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        // Token expired, try to refresh
        const refreshed = await refreshToken()
        if (!refreshed) return

        // Retry with new token
        token = localStorage.getItem('accessToken')
        response = await fetch(`/api/integrations/${provider}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      }

      if (response.ok) {
        alert('Integration disconnected successfully')
        router.push('/dashboard/settings/integrations')
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to disconnect')
      }
    } catch (error) {
      console.error('Failed to disconnect integration:', error)
      alert('Failed to disconnect integration')
    }
  }

  const updateFormField = (key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  const handleRegenerateSecret = async () => {
    try {
      let token = localStorage.getItem('accessToken')
      if (!token) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
      }

      let response = await fetch(`/api/integrations/${provider}/regenerate-secret`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        const refreshed = await refreshToken()
        if (!refreshed) return
        token = localStorage.getItem('accessToken')
        response = await fetch(`/api/integrations/${provider}/regenerate-secret`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        })
      }

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'Failed to regenerate secret')
        return
      }

      const result = await response.json()
      setWebhookSecret(result.secret)
      setFormData((prev) => ({ ...prev, webhookSecret: result.secret }))
      alert('Secret regenerated! Make sure to copy and update it in web.whatis.')
      fetchConnection()
    } catch (error) {
      console.error('Failed to regenerate secret:', error)
      alert('Failed to regenerate secret')
    }
  }

  const renderField = (field: any) => {
    // Check dependencies
    if (field.dependsOn) {
      const dependsValue = formData[field.dependsOn]
      if (dependsValue === 'none' || !dependsValue || dependsValue !== field.dependsOn) {
        // Check if this field should be shown based on dependency
        if (field.dependsOn === 'provider') {
          const selectedProvider = formData.provider
          if (field.key.includes('twilio') && selectedProvider !== 'twilio') {
            return null
          }
          if (field.key.includes('meta') && selectedProvider !== 'meta') {
            return null
          }
          if (field.key.includes('mailgun') && selectedProvider !== 'mailgun') {
            return null
          }
        } else {
          return null
        }
      }
    }

    const value = formData[field.key] || ''

    if (field.type === 'select') {
      return (
        <div key={field.key}>
          <Label htmlFor={field.key}>{field.label}</Label>
          <Select value={value || 'none'} onValueChange={(v) => updateFormField(field.key, v === 'none' ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((opt: any) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }

    if (field.type === 'secret') {
      // Special handling for webhook secrets - must be visible and copyable
      const secretValue = field.key === 'webhookSecret' ? webhookSecret || value : value
      return (
        <SecretField
          key={field.key}
          label={field.label}
          value={secretValue}
          onChange={(newValue) => {
            if (field.key === 'webhookSecret') {
              setWebhookSecret(newValue)
            }
            updateFormField(field.key, newValue)
          }}
          readOnly={field.key === 'webhookSecret'} // Webhook secrets are auto-generated, read-only
          onRegenerate={field.key === 'webhookSecret' ? handleRegenerateSecret : undefined}
          warningText={
            field.key === 'webhookSecret'
              ? 'Keep this secret private. Anyone with it can spoof inbound webhooks.'
              : undefined
          }
        />
      )
    }

    if (field.type === 'password') {
      return (
        <div key={field.key}>
          <Label htmlFor={field.key}>{field.label}</Label>
          <Input
            id={field.key}
            type="password"
            value={value}
            onChange={(e) => updateFormField(field.key, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
          {field.description && (
            <p className="mt-1 text-sm text-gray-500">{field.description}</p>
          )}
        </div>
      )
    }

    if (field.type === 'textarea') {
      return (
        <div key={field.key}>
          <Label htmlFor={field.key}>{field.label}</Label>
          <Textarea
            id={field.key}
            value={value}
            onChange={(e) => updateFormField(field.key, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        </div>
      )
    }

    return (
      <div key={field.key}>
        <Label htmlFor={field.key}>{field.label}</Label>
        <Input
          id={field.key}
          type={field.type || 'text'}
          value={value}
          onChange={(e) => updateFormField(field.key, e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
        />
        {field.description && (
          <p className="mt-1 text-sm text-gray-500">{field.description}</p>
        )}
      </div>
    )
  }

  if (loading || !integration) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  const status = connection?.status || 'NOT_CONFIGURED'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/dashboard/settings/integrations">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{integration.name}</h1>
            <p className="mt-1 text-gray-600">{integration.description}</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              statusColors[status] || 'bg-gray-100 text-gray-800'
            }`}
          >
            {status === 'CONNECTED' && <CheckCircle className="mr-1 h-4 w-4" />}
            {status === 'ERROR' && <XCircle className="mr-1 h-4 w-4" />}
            {status === 'CONNECTING' && <Clock className="mr-1 h-4 w-4" />}
            {status === 'NOT_CONFIGURED' && <AlertCircle className="mr-1 h-4 w-4" />}
            {status === 'NOT_CONFIGURED' ? 'Not Configured' : status === 'CONNECTED' ? 'Connected' : status}
          </span>
        </div>
      </div>

      {connection?.lastError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-start space-x-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div>
                <p className="font-semibold text-red-900">Last Error</p>
                <p className="text-sm text-red-700 mt-1">{connection.lastError}</p>
                {connection.lastCheckedAt && (
                  <p className="text-xs text-red-600 mt-1">
                    Occurred: {formatDate(connection.lastCheckedAt)}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>Enter your integration credentials</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {integration.configFields && integration.configFields.length > 0 ? (
            integration.configFields.map((field: any) => renderField(field))
          ) : provider === 'quickbooks' ? (
            <div className="text-center py-8 space-y-4">
              <p className="text-gray-600 mb-4">QuickBooks uses OAuth 2.0 for authentication.</p>
              {status !== 'CONNECTED' ? (
                <Button onClick={handleConnectQuickBooks}>Connect QuickBooks</Button>
              ) : (
                <div className="space-y-2">
                  {connection?.metadata?.realmId && (
                    <p className="text-sm text-gray-600">
                      Connected to Realm: {connection.metadata.realmId}
                    </p>
                  )}
                  <div className="flex justify-center space-x-2">
                    <Button onClick={handleTest} disabled={testing} variant="outline">
                      <TestTube className="mr-2 h-4 w-4" />
                      {testing ? 'Testing...' : 'Test Connection'}
                    </Button>
                    <Button variant="destructive" onClick={handleDisconnect}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Disconnect
                    </Button>
                  </div>
                </div>
              )}
              {testResult && (
                <div
                  className={`p-4 rounded-lg mt-4 ${
                    testResult.success
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-red-50 border border-red-200'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    {testResult.success ? (
                      <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                    )}
                    <div>
                      <p className={`font-semibold ${testResult.success ? 'text-green-900' : 'text-red-900'}`}>
                        {testResult.success ? 'Test Successful' : 'Test Failed'}
                      </p>
                      <p className={`text-sm mt-1 ${testResult.success ? 'text-green-700' : 'text-red-700'}`}>
                        {testResult.message}
                      </p>
                      {testResult.error && (
                        <p className="text-xs text-red-600 mt-2">{testResult.error}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-600">No configuration required.</p>
          )}

          {provider !== 'quickbooks' && (
            <div className="flex space-x-2 pt-4">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={testing || status === 'NOT_CONFIGURED'}>
                <TestTube className="mr-2 h-4 w-4" />
                {testing ? 'Testing...' : 'Test Connection'}
              </Button>
              {status !== 'NOT_CONFIGURED' && (
                <Button variant="destructive" onClick={handleDisconnect}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Disconnect
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Section */}
      {(provider === 'voipms_sms' || provider === 'whatsapp' || provider === 'email') && (
        <Card>
          <CardHeader>
            <CardTitle>Test Integration</CardTitle>
            <CardDescription>Send a test message to verify your configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(provider === 'voipms_sms' || provider === 'whatsapp') && (
              <div>
                <Label htmlFor="testPhone">Phone Number</Label>
                <Input
                  id="testPhone"
                  type="tel"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+15551234567"
                />
              </div>
            )}
            {provider === 'email' && (
              <div>
                <Label htmlFor="testEmail">Email Address</Label>
                <Input
                  id="testEmail"
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="test@example.com"
                />
              </div>
            )}
            <Button onClick={handleTest} disabled={testing}>
              <TestTube className="mr-2 h-4 w-4" />
              {testing ? 'Sending...' : 'Send Test Message'}
            </Button>

            {testResult && (
              <div
                className={`p-4 rounded-lg ${
                  testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                }`}
              >
                <div className="flex items-start space-x-3">
                  {testResult.success ? (
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                  )}
                  <div>
                    <p className={`font-semibold ${testResult.success ? 'text-green-900' : 'text-red-900'}`}>
                      {testResult.success ? 'Test Successful' : 'Test Failed'}
                    </p>
                    <p className={`text-sm mt-1 ${testResult.success ? 'text-green-700' : 'text-red-700'}`}>
                      {testResult.message}
                    </p>
                    {testResult.error && (
                      <p className="text-xs text-red-600 mt-2">{testResult.error}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {connection?.lastCheckedAt && (
        <div className="text-sm text-gray-500">
          Last checked: {formatDate(connection.lastCheckedAt)}
        </div>
      )}
    </div>
  )
}
