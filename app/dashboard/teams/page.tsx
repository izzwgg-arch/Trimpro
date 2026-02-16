'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ViewModeSelector } from '@/components/ui/ViewModeSelector'
import { useViewMode } from '@/hooks/useViewMode'
import { RowCompactItem } from '@/components/lists/RowCompactItem'
import { RowDetailedItem } from '@/components/lists/RowDetailedItem'
import { TableView } from '@/components/lists/TableView'
import { Users, Plus, Search, Mail, Phone, Briefcase, X } from 'lucide-react'

interface TeamMember {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  role: string
  status: string
  _count: {
    schedules: number
  }
}

export default function TeamsPage() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [viewMode, setViewMode] = useViewMode('team', 'grid')
  const [inviteForm, setInviteForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    role: 'FIELD' as 'ADMIN' | 'OFFICE' | 'FIELD' | 'SALES' | 'ACCOUNTING',
  })

  useEffect(() => {
    fetchTeam()
  }, [])

  const fetchTeam = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/schedules/team', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 401) {
        window.location.href = '/auth/login'
        return
      }

      if (response.ok) {
        const data = await response.json()
        setTeamMembers(data.teamMembers || [])
      }
    } catch (error) {
      console.error('Error fetching team:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteError('')
    setInviteSuccess(false)
    setInviteLoading(true)

    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/users/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(inviteForm),
      })

      if (response.status === 401) {
        window.location.href = '/auth/login'
        return
      }

      const data = await response.json()

      if (!response.ok) {
        setInviteError(data.error || 'Failed to invite user')
        setInviteLoading(false)
        return
      }

      setInviteSuccess(true)
      setInviteForm({
        email: '',
        firstName: '',
        lastName: '',
        phone: '',
        role: 'FIELD',
      })
      
      // Refresh team list
      await fetchTeam()
      
      // Close modal after 2 seconds
      setTimeout(() => {
        setShowInviteModal(false)
        setInviteSuccess(false)
      }, 2000)
    } catch (error) {
      console.error('Error inviting user:', error)
      setInviteError('An error occurred. Please try again.')
    } finally {
      setInviteLoading(false)
    }
  }

  const filteredMembers = teamMembers.filter((member) => {
    const searchLower = search.toLowerCase()
    return (
      member.firstName.toLowerCase().includes(searchLower) ||
      member.lastName.toLowerCase().includes(searchLower) ||
      member.email.toLowerCase().includes(searchLower) ||
      member.role.toLowerCase().includes(searchLower)
    )
  })

  const roleColors: Record<string, string> = {
    ADMIN: 'bg-purple-100 text-purple-800',
    OFFICE: 'bg-blue-100 text-blue-800',
    FIELD: 'bg-green-100 text-green-800',
    SALES: 'bg-yellow-100 text-yellow-800',
    ACCOUNTING: 'bg-pink-100 text-pink-800',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading team...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Team Management</h1>
          <p className="mt-2 text-gray-600">View and manage your team members</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeSelector value={viewMode} onChange={setViewMode} />
          <Button onClick={() => setShowInviteModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Invite User
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search team members..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {viewMode === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredMembers.map((member) => (
            <Card key={member.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    {member.firstName} {member.lastName}
                  </CardTitle>
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${roleColors[member.role] || 'bg-gray-100 text-gray-800'}`}>
                    {member.role}
                  </span>
                </div>
                <CardDescription>
                  {member.status === 'ACTIVE' ? <span className="text-green-600">Active</span> : <span className="text-gray-500">{member.status}</span>}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center text-sm text-gray-600">
                  <Mail className="mr-2 h-4 w-4" />
                  {member.email}
                </div>
                {member.phone && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Phone className="mr-2 h-4 w-4" />
                    {member.phone}
                  </div>
                )}
                <div className="flex items-center text-sm text-gray-600">
                  <Briefcase className="mr-2 h-4 w-4" />
                  {member._count.schedules} scheduled items
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : viewMode === 'rowCompact' ? (
        <div className="space-y-2">
          {filteredMembers.map((member) => (
            <RowCompactItem
              key={member.id}
              primary={`${member.firstName} ${member.lastName}`}
              secondary={member.email}
              status={<span className={`px-2 py-1 text-xs rounded-full ${roleColors[member.role] || 'bg-gray-100 text-gray-800'}`}>{member.role}</span>}
              amount={member.status}
              date={`${member._count.schedules} schedules`}
            />
          ))}
        </div>
      ) : viewMode === 'rowDetailed' ? (
        <div className="space-y-2">
          {filteredMembers.map((member) => (
            <RowDetailedItem
              key={member.id}
              primary={`${member.firstName} ${member.lastName}`}
              status={<span className={`px-2 py-1 text-xs rounded-full ${roleColors[member.role] || 'bg-gray-100 text-gray-800'}`}>{member.role}</span>}
              line2={`${member.email}${member.phone ? ` • ${member.phone}` : ''}`}
              rightTop={member.status}
              rightBottom={`${member._count.schedules} schedules`}
            />
          ))}
        </div>
      ) : (
        <TableView
          data={filteredMembers}
          rowKey={(member) => member.id}
          columns={[
            {
              key: 'name',
              header: 'Name',
              sortValue: (member) => `${member.firstName} ${member.lastName}`,
              render: (member) => <span className="font-medium">{member.firstName} {member.lastName}</span>,
            },
            {
              key: 'role',
              header: 'Role',
              sortValue: (member) => member.role,
              render: (member) => <span className={`px-2 py-1 text-xs rounded-full ${roleColors[member.role] || 'bg-gray-100 text-gray-800'}`}>{member.role}</span>,
            },
            {
              key: 'email',
              header: 'Email',
              sortValue: (member) => member.email,
              render: (member) => member.email,
            },
            {
              key: 'status',
              header: 'Status',
              sortValue: (member) => member.status,
              render: (member) => member.status,
            },
            {
              key: 'schedules',
              header: 'Schedules',
              sortValue: (member) => member._count.schedules,
              render: (member) => member._count.schedules,
            },
          ]}
        />
      )}

      {filteredMembers.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">No team members found</h3>
            <p className="mt-2 text-gray-600">
              {search ? 'Try adjusting your search' : 'Get started by inviting team members'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Invite User Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md m-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Invite New User</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowInviteModal(false)
                    setInviteError('')
                    setInviteSuccess(false)
                    setInviteForm({
                      email: '',
                      firstName: '',
                      lastName: '',
                      phone: '',
                      role: 'FIELD',
                    })
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>Send an invitation to a new team member</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInviteUser} className="space-y-4">
                {inviteError && (
                  <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
                    {inviteError}
                  </div>
                )}
                {inviteSuccess && (
                  <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded">
                    User invited successfully! The invitation email has been sent.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="firstName">First Name *</Label>
                    <Input
                      id="firstName"
                      value={inviteForm.firstName}
                      onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last Name *</Label>
                    <Input
                      id="lastName"
                      value={inviteForm.lastName}
                      onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={inviteForm.phone}
                    onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="role">Role *</Label>
                  <Select
                    value={inviteForm.role}
                    onValueChange={(value) => setInviteForm({ ...inviteForm, role: value as any })}
                  >
                    <SelectTrigger id="role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIELD">Field Worker</SelectItem>
                      <SelectItem value="OFFICE">Office Staff</SelectItem>
                      <SelectItem value="SALES">Sales</SelectItem>
                      <SelectItem value="ACCOUNTING">Accounting</SelectItem>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setShowInviteModal(false)
                      setInviteError('')
                      setInviteSuccess(false)
                      setInviteForm({
                        email: '',
                        firstName: '',
                        lastName: '',
                        phone: '',
                        role: 'FIELD',
                      })
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1" disabled={inviteLoading}>
                    {inviteLoading ? 'Sending...' : 'Send Invitation'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
