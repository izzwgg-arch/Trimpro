'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PaginationControls } from '@/components/ui/PaginationControls'
import { TableView, type TableColumn } from '@/components/lists/TableView'
import { Filter, Ruler, Search } from 'lucide-react'
import { ScopeFilter, type ListScope } from '@/components/lists/ScopeFilter'

type MeasuringRequestRow = {
  id: string
  requestId: string
  status: 'pending' | 'opened' | 'completed'
  notes?: string | null
  createdAt: string
  openedAt?: string | null
  completedAt?: string | null
  notificationAttempts: number
  request: {
    id: string
    customerName: string
    address?: string | null
  }
  assignedUser: {
    id: string
    firstName: string
    lastName: string
    email: string | null
  }
  createdByUser: {
    id: string
    firstName: string
    lastName: string
  }
}

type AssignableUser = {
  id: string
  firstName: string
  lastName: string
  email: string | null
}

const statusBadgeClass: Record<MeasuringRequestRow['status'], string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  opened: 'bg-blue-100 text-blue-800 border-blue-200',
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
}

export default function MeasuringRequestsAdminPage() {
  const router = useRouter()
  const [rows, setRows] = useState<MeasuringRequestRow[]>([])
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [assignedUserId, setAssignedUserId] = useState('all')
  const [scope, setScope] = useState<ListScope>('all')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [completingId, setCompletingId] = useState<string | null>(null)

  useEffect(() => {
    void fetchAssignableUsers()
  }, [])

  useEffect(() => {
    setPage(1)
  }, [search, status, assignedUserId, scope])

  useEffect(() => {
    void fetchRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, assignedUserId, scope, page])

  const fetchAssignableUsers = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) return
      const response = await fetch('/api/measuring-requests/assignable-users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) return
      const payload = await response.json().catch(() => ({ users: [] }))
      setUsers(Array.isArray(payload?.users) ? payload.users : [])
    } catch (error) {
      console.error('Failed to fetch measuring assignees:', error)
    }
  }

  const fetchRows = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }
      const params = new URLSearchParams({
        search,
        status,
        page: String(page),
        limit: '50',
      })
      if (assignedUserId !== 'all') params.set('assignedUserId', assignedUserId)
      if (scope !== 'all') params.set('scope', scope)
      const response = await fetch(`/api/measuring-requests?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.status === 401) {
        router.push('/auth/login')
        return
      }
      if (response.status === 403) {
        alert('You do not have permission to view measuring requests.')
        router.push('/dashboard')
        return
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Failed to load measuring requests' }))
        alert(payload.error || 'Failed to load measuring requests')
        return
      }
      const payload = await response.json()
      setRows(Array.isArray(payload?.measuringRequests) ? payload.measuringRequests : [])
      setTotalPages(Number(payload?.pagination?.totalPages || 1))
      setTotal(Number(payload?.pagination?.total || 0))
    } catch (error) {
      console.error('Failed to fetch measuring requests:', error)
      alert('Failed to load measuring requests')
    } finally {
      setLoading(false)
    }
  }

  const handleMarkCompleted = async (id: string) => {
    setCompletingId(id)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }
      const response = await fetch(`/api/measuring-requests/${id}/complete`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Failed to complete measuring request' }))
        alert(payload.error || 'Failed to complete measuring request')
        return
      }
      await fetchRows()
    } catch (error) {
      console.error('Failed to complete measuring request:', error)
      alert('Failed to complete measuring request')
    } finally {
      setCompletingId(null)
    }
  }

  const columns: TableColumn<MeasuringRequestRow>[] = [
    {
      key: 'request',
      header: 'Request',
      sortValue: (row) => row.request.id,
      render: (row) => <span className="font-medium">{row.request.id}</span>,
    },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (row) => row.request.customerName,
      render: (row) => (
        <div>
          <div>{row.request.customerName}</div>
          {row.request.address ? (
            <div className="max-w-[320px] truncate text-xs text-gray-500">{row.request.address}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'assignedTo',
      header: 'Assigned To',
      sortValue: (row) => `${row.assignedUser.firstName} ${row.assignedUser.lastName}`,
      render: (row) => (
        <>
          {row.assignedUser.firstName} {row.assignedUser.lastName}
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (row) => row.status,
      render: (row) => (
        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass[row.status]}`}>
          {row.status}
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => (
        <div className="text-xs text-gray-600">
          <div>{new Date(row.createdAt).toLocaleString()}</div>
          {row.completedAt ? <div>Done {new Date(row.completedAt).toLocaleString()}</div> : null}
        </div>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      sortValue: (row) => row.notes || '',
      render: (row) => (
        <div className="text-xs text-gray-600">
          <div className="max-w-[260px] truncate">{row.notes || '-'}</div>
          <div>Reminders: {row.notificationAttempts}</div>
        </div>
      ),
    },
    {
      key: 'address',
      header: 'Address',
      defaultHidden: true,
      sortValue: (row) => row.request.address || '',
      render: (row) => <span className="text-xs text-gray-600">{row.request.address || '-'}</span>,
    },
    {
      key: 'assigneeEmail',
      header: 'Assignee Email',
      defaultHidden: true,
      sortValue: (row) => row.assignedUser.email || '',
      render: (row) => <span className="text-xs text-gray-600">{row.assignedUser.email || '-'}</span>,
    },
    {
      key: 'openedAt',
      header: 'Opened',
      defaultHidden: true,
      sortValue: (row) => (row.openedAt ? new Date(row.openedAt).getTime() : 0),
      render: (row) => (
        <span className="text-xs text-gray-600">{row.openedAt ? new Date(row.openedAt).toLocaleString() : '-'}</span>
      ),
    },
    {
      key: 'completedAt',
      header: 'Completed',
      defaultHidden: true,
      sortValue: (row) => (row.completedAt ? new Date(row.completedAt).getTime() : 0),
      render: (row) => (
        <span className="text-xs text-gray-600">{row.completedAt ? new Date(row.completedAt).toLocaleString() : '-'}</span>
      ),
    },
    {
      key: 'notificationAttempts',
      header: 'Reminders',
      defaultHidden: true,
      sortValue: (row) => row.notificationAttempts,
      render: (row) => <span className="text-xs text-gray-600">{row.notificationAttempts}</span>,
    },
    {
      key: 'createdBy',
      header: 'Created By',
      defaultHidden: true,
      sortValue: (row) => `${row.createdByUser.firstName} ${row.createdByUser.lastName}`,
      render: (row) => (
        <span className="text-xs text-gray-600">
          {row.createdByUser.firstName} {row.createdByUser.lastName}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      locked: true,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              router.push(`/dashboard/requests/${row.requestId}`)
            }}
          >
            Open Request
          </Button>
          {row.status !== 'completed' ? (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                void handleMarkCompleted(row.id)
              }}
              disabled={completingId === row.id}
            >
              {completingId === row.id ? 'Saving...' : 'Mark Completed'}
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Measuring Requests</h1>
          <p className="mt-2 text-gray-600">Track and manage field measuring assignments.</p>
        </div>
        <div className="inline-flex items-center rounded-md border bg-white px-3 py-2 text-sm text-gray-700">
          <Ruler className="mr-2 h-4 w-4" />
          {total} total
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter by status, assignee, or search text.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-10"
                placeholder="Search customer, address, notes..."
              />
            </div>
            <div className="inline-flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="OPENED">Opened</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={assignedUserId} onValueChange={setAssignedUserId}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Assignees</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ScopeFilter
                value={scope}
                onChange={setScope}
                className="h-9 w-[200px] rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500">Loading measuring requests...</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">No measuring requests found.</div>
          ) : (
            <TableView
              tableKey="measuring-requests"
              data={rows}
              rowKey={(row) => row.id}
              columns={columns}
              onRowClick={(row) => router.push(`/dashboard/requests/${row.requestId}`)}
            />
          )}
        </CardContent>
      </Card>

      <PaginationControls
        page={page}
        totalPages={totalPages}
        total={total}
        disabled={loading}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />
    </div>
  )
}
