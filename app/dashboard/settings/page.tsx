'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { User, Bell, Shield, Link as LinkIcon, Mail, Users, Palette, Wrench } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { refreshAccessToken } from '@/lib/auth/client'
import Link from 'next/link'

export default function SettingsPage() {
  const router = useRouter()
  const pathname = usePathname()
  
  // Determine active tab based on current path
  const getActiveTab = () => {
    if (pathname?.includes('/settings/integrations')) return 'integrations'
    if (pathname?.includes('/settings/roles')) return 'roles'
    return 'profile'
  }
  
  const [activeTab, setActiveTab] = useState(getActiveTab())
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingSender, setSavingSender] = useState(false)
  const [testingSender, setTestingSender] = useState(false)
  const [profile, setProfile] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  })
  const [senderProfile, setSenderProfile] = useState({
    fromEmail: '',
    fromName: '',
    replyToEmail: '',
    appPassword: '',
    isActive: true,
    status: 'NOT_CONFIGURED',
    lastError: '',
  })
  
  useEffect(() => {
    setActiveTab(getActiveTab())
  }, [pathname])

  const authFetch = async (url: string, init?: RequestInit) => {
    let token = localStorage.getItem('accessToken')
    if (!token) {
      const refreshed = await refreshAccessToken()
      if (!refreshed) {
        router.push('/auth/login')
        return null
      }
      token = localStorage.getItem('accessToken')
    }

    let response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })

    if (response.status === 401) {
      const refreshed = await refreshAccessToken()
      if (!refreshed) {
        router.push('/auth/login')
        return null
      }
      token = localStorage.getItem('accessToken')
      response = await fetch(url, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          Authorization: `Bearer ${token}`,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
      })
    }
    return response
  }

  useEffect(() => {
    const load = async () => {
      const meRes = await authFetch('/api/me')
      if (meRes?.ok) {
        const data = await meRes.json()
        const me = data.user || {}
        setProfile({
          firstName: me.firstName || '',
          lastName: me.lastName || '',
          email: me.email || '',
          phone: me.phone || '',
        })
      }

      const senderRes = await authFetch('/api/me/email-sender')
      if (senderRes?.ok) {
        const data = await senderRes.json()
        if (data.profile) {
          setSenderProfile((prev) => ({
            ...prev,
            fromEmail: data.profile.fromEmail || '',
            fromName: data.profile.fromName || '',
            replyToEmail: data.profile.replyToEmail || '',
            appPassword: '',
            isActive: data.profile.isActive ?? true,
            status: data.profile.status || 'ACTIVE',
            lastError: data.profile.lastError || '',
          }))
        }
      }
    }
    load()
  }, [])

  const saveProfile = async () => {
    setSavingProfile(true)
    setTimeout(() => {
      setSavingProfile(false)
      alert('Profile update endpoint is not available yet in this build.')
    }, 350)
  }

  const saveSenderProfile = async () => {
    setSavingSender(true)
    try {
      const res = await authFetch('/api/me/email-sender', {
        method: 'PUT',
        body: JSON.stringify({
          fromEmail: senderProfile.fromEmail,
          fromName: senderProfile.fromName || undefined,
          replyToEmail: senderProfile.replyToEmail || undefined,
          appPassword: senderProfile.appPassword || undefined,
          isActive: senderProfile.isActive,
        }),
      })
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || 'Failed to save sender profile')
        return
      }
      setSenderProfile((prev) => ({
        ...prev,
        appPassword: '',
        status: data.profile?.status || 'ACTIVE',
        lastError: data.profile?.lastError || '',
      }))
      alert('Google Workspace sender saved.')
    } finally {
      setSavingSender(false)
    }
  }

  const testSenderProfile = async () => {
    setTestingSender(true)
    try {
      const res = await authFetch('/api/me/email-sender/test', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      if (!res) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || 'Test failed')
        return
      }
      alert(data.message || 'Test email sent.')
      setSenderProfile((prev) => ({ ...prev, status: 'ACTIVE', lastError: '' }))
    } finally {
      setTestingSender(false)
    }
  }

  const removeSenderProfile = async () => {
    if (!confirm('Remove your Google Workspace sender profile?')) return
    const res = await authFetch('/api/me/email-sender', { method: 'DELETE' })
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}))
      alert(data?.error || 'Failed to remove sender profile.')
      return
    }
    setSenderProfile({
      fromEmail: '',
      fromName: '',
      replyToEmail: '',
      appPassword: '',
      isActive: true,
      status: 'NOT_CONFIGURED',
      lastError: '',
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="mt-2 text-gray-600">Manage your account settings and preferences</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Palette className="h-5 w-5" />
              Branding
            </CardTitle>
            <CardDescription>
              Update logo, favicon, invoice branding, and email branding.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/settings/branding">
              <Button>Open Branding Settings</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wrench className="h-5 w-5" />
              Advanced Settings
            </CardTitle>
            <CardDescription>
              Manage integrations and sender configuration pages.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href="/dashboard/settings/integrations">
              <Button variant="outline">Integrations</Button>
            </Link>
            <Link href="/dashboard/settings/email-integrations">
              <Button variant="outline">Email Integrations</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="flex space-x-4 border-b">
        <button
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-2 border-b-2 ${
            activeTab === 'profile'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <User className="inline mr-2 h-4 w-4" />
          Profile
        </button>
        <button
          onClick={() => setActiveTab('notifications')}
          className={`px-4 py-2 border-b-2 ${
            activeTab === 'notifications'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <Bell className="inline mr-2 h-4 w-4" />
          Notifications
        </button>
        <button
          onClick={() => router.push('/dashboard/settings/integrations')}
          className={`px-4 py-2 border-b-2 ${
            activeTab === 'integrations'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <LinkIcon className="inline mr-2 h-4 w-4" />
          Integrations
        </button>
        <button
          onClick={() => router.push('/dashboard/settings/roles')}
          className={`px-4 py-2 border-b-2 ${
            activeTab === 'roles'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <Users className="inline mr-2 h-4 w-4" />
          Roles & Permissions
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`px-4 py-2 border-b-2 ${
            activeTab === 'security'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <Shield className="inline mr-2 h-4 w-4" />
          Security
        </button>
      </div>

      {activeTab === 'profile' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={profile.firstName}
                    onChange={(e) => setProfile((prev) => ({ ...prev, firstName: e.target.value }))}
                    placeholder="John"
                  />
                </div>
                <div>
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={profile.lastName}
                    onChange={(e) => setProfile((prev) => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Doe"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="john@example.com"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                />
              </div>
              <Button onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? 'Saving...' : 'Save Changes'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Google Workspace Sender (Your Profile)</CardTitle>
              <CardDescription>
                Used only for invoices/estimates you send. System email remains default for platform mail and fallback.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="senderFromEmail">From Email</Label>
                  <Input
                    id="senderFromEmail"
                    type="email"
                    value={senderProfile.fromEmail}
                    onChange={(e) =>
                      setSenderProfile((prev) => ({ ...prev, fromEmail: e.target.value }))
                    }
                    placeholder="you@yourcompany.com"
                  />
                </div>
                <div>
                  <Label htmlFor="senderFromName">From Name (optional)</Label>
                  <Input
                    id="senderFromName"
                    value={senderProfile.fromName}
                    onChange={(e) =>
                      setSenderProfile((prev) => ({ ...prev, fromName: e.target.value }))
                    }
                    placeholder="Your Name"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="senderReplyTo">Reply-To (optional)</Label>
                  <Input
                    id="senderReplyTo"
                    type="email"
                    value={senderProfile.replyToEmail}
                    onChange={(e) =>
                      setSenderProfile((prev) => ({ ...prev, replyToEmail: e.target.value }))
                    }
                    placeholder="support@yourcompany.com"
                  />
                </div>
                <div>
                  <Label htmlFor="senderAppPassword">Google App Password</Label>
                  <Input
                    id="senderAppPassword"
                    type="password"
                    value={senderProfile.appPassword}
                    onChange={(e) =>
                      setSenderProfile((prev) => ({ ...prev, appPassword: e.target.value }))
                    }
                    placeholder="16-character app password"
                  />
                </div>
              </div>

              {senderProfile.lastError ? (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Last sender error: {senderProfile.lastError}
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button onClick={saveSenderProfile} disabled={savingSender}>
                  {savingSender ? 'Saving...' : 'Save Sender'}
                </Button>
                <Button variant="outline" onClick={testSenderProfile} disabled={testingSender}>
                  {testingSender ? 'Testing...' : 'Send Test'}
                </Button>
                <Button variant="destructive" onClick={removeSenderProfile}>
                  Remove
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'notifications' && (
        <Card>
          <CardHeader>
            <CardTitle>Notification Preferences</CardTitle>
            <CardDescription>Configure how you receive notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-gray-500">Receive notifications via email</p>
              </div>
              <input type="checkbox" defaultChecked className="h-4 w-4" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">SMS Notifications</p>
                <p className="text-sm text-gray-500">Receive notifications via SMS</p>
              </div>
              <input type="checkbox" className="h-4 w-4" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Payment Alerts</p>
                <p className="text-sm text-gray-500">Get notified when payments are received</p>
              </div>
              <input type="checkbox" defaultChecked className="h-4 w-4" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Job Updates</p>
                <p className="text-sm text-gray-500">Get notified about job status changes</p>
              </div>
              <input type="checkbox" defaultChecked className="h-4 w-4" />
            </div>
            <Button>Save Preferences</Button>
          </CardContent>
        </Card>
      )}


      {activeTab === 'security' && (
        <Card>
          <CardHeader>
            <CardTitle>Security Settings</CardTitle>
            <CardDescription>Manage your password and security preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input id="currentPassword" type="password" />
            </div>
            <div>
              <Label htmlFor="newPassword">New Password</Label>
              <Input id="newPassword" type="password" />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input id="confirmPassword" type="password" />
            </div>
            <Button>Update Password</Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
