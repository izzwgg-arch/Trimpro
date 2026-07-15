'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ViewModeSelector } from '@/components/ui/ViewModeSelector'
import { useViewMode } from '@/hooks/useViewMode'
import { RowCompactItem } from '@/components/lists/RowCompactItem'
import { RowDetailedItem } from '@/components/lists/RowDetailedItem'
import { TableView } from '@/components/lists/TableView'
import { PaginationControls } from '@/components/ui/PaginationControls'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, Filter, Briefcase, Calendar, DollarSign, Trash2, Copy } from 'lucide-react'
import Link from 'next/link'
import { useDocumentListAccess } from '@/hooks/useDocumentListAccess'
import { CreateOnlyAccessCard } from '@/components/permissions/CreateOnlyAccessCard'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { JOB_STATUSES } from '@/lib/jobs/statuses'
import { JobStatusSelect } from '@/components/jobs/JobStatusSelect'

interface Job {
  id: string
  jobNumber: string
  title: string
  description: string | null
  status: string
  priority: number
  scheduledStart: string | null
  scheduledEnd: string | null
  estimateAmount: string | null
  totalCost?: string | null
  openInvoiceBalance?: string
  openInvoiceCount?: number
  clientOpenInvoiceBalance?: string
  client: {
    id: string
    name: string
    companyName: string | null
  }
  assignments: Array<{
    id: string
    role: string | null
    user: {
      id: string
      firstName: string
      lastName: string
    }
  }>
  _count: {
    tasks: number
    issues: number
  }
}

const priorityLabels: Record<number, string> = {
  1: 'Low',
  2: 'Low-Medium',
  3: 'Medium',
  4: 'Medium-High',
  5: 'High',
}

export default function JobsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { permissionsLoading, canViewList, canCreate } = useDocumentListAccess('jobs.view', 'jobs.create')
  const [jobs, setJobs] = useState<Job[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useViewMode('jobs', 'grid')

  useEffect(() => {
    const statusParam = searchParams.get('status')
    if (statusParam) {
      setStatus(statusParam)
    }
  }, [searchParams])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, status])

  useEffect(() => {
    if (permissionsLoading) return
    fetchJobs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, status, page, permissionsLoading, canViewList])

  const fetchJobs = async () => {
    if (!canViewList) {
      setJobs([])
      setInitialLoading(false)
      setIsFetching(false)
      return
    }

    setIsFetching(true)
    try {
      const token = localStorage.getItem('accessToken')
      const params = new URLSearchParams({
        search: debouncedSearch,
        status,
        page: String(page),
        limit: '50',
      })

      const response = await fetch(`/api/jobs?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      const data = await response.json()
      setJobs(data.jobs || [])
      setTotalPages(Number(data?.pagination?.totalPages || 1))
      setTotal(Number(data?.pagination?.total || 0))
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      setInitialLoading(false)
      setIsFetching(false)
    }
  }

  const handleDelete = async (jobId: string, jobTitle: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete job "${jobTitle}"?\n\n` +
      'This action cannot be undone. If the job has invoices, it will be cancelled instead.'
    )

    if (!confirmed) return

    setDeletingId(jobId)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/jobs/${jobId}`, {
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
        const error = await response.json()
        alert(error.error || 'Failed to delete job')
        setDeletingId(null)
        return
      }

      // Refresh the jobs list
      fetchJobs()
    } catch (error) {
      console.error('Error deleting job:', error)
      alert('Failed to delete job')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDuplicateSelected = async () => {
    if (selectedIds.length === 0) return
    if (!confirm(`Duplicate ${selectedIds.length} selected job(s)?`)) return

    setDuplicating(true)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      for (const jobId of selectedIds) {
        const response = await fetch(`/api/jobs/${jobId}/duplicate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          alert(data.error || 'Failed to duplicate one or more jobs')
          break
        }
      }

      setSelectedIds([])
      fetchJobs()
    } catch (error) {
      console.error('Failed duplicating jobs:', error)
      alert('Failed to duplicate selected jobs')
    } finally {
      setDuplicating(false)
    }
  }

  const toggleSelected = (jobId: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? (prev.includes(jobId) ? prev : [...prev, jobId]) : prev.filter((id) => id !== jobId)
    )
  }

  if (initialLoading || permissionsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading jobs...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Jobs</h1>
          <p className="mt-2 text-gray-600">Manage your jobs and projects</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeSelector value={viewMode} onChange={setViewMode} />
          {canViewList && (
            <Button
              variant="outline"
              onClick={handleDuplicateSelected}
              disabled={selectedIds.length === 0 || duplicating}
            >
              <Copy className="mr-2 h-4 w-4" />
              {duplicating ? 'Duplicating...' : `Duplicate${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => router.push('/dashboard/jobs/new')}>
              <Plus className="mr-2 h-4 w-4" />
              New Job
            </Button>
          )}
        </div>
      </div>

      {!canViewList && (
        <CreateOnlyAccessCard
          icon={Briefcase}
          entityLabel="jobs"
          createButtonLabel="New Job"
          canCreate={canCreate}
          onCreate={() => router.push('/dashboard/jobs/new')}
        />
      )}

      {canViewList && (
        <>
      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search jobs by #, title, client, crew, or address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[220px] text-sm">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  {JOB_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Jobs List */}
      {viewMode === 'grid' ? (
      <div className="space-y-4">
        {jobs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No jobs</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by creating a new job.
              </p>
              <div className="mt-6">
                <Button onClick={() => router.push('/dashboard/jobs/new')}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Job
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          jobs.map((job) => (
            <Card key={job.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <Link href={`/dashboard/jobs/${job.id}`}>
                      <CardTitle className="text-lg hover:text-primary cursor-pointer">
                        {job.title}
                      </CardTitle>
                    </Link>
                    <CardDescription className="mt-1">
                      {job.jobNumber} - {job.client.name}
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(job.id)}
                      onChange={(e) => toggleSelected(job.id, e.target.checked)}
                      className="h-4 w-4"
                      title="Select for duplicate"
                    />
                    <JobStatusSelect
                      jobId={job.id}
                      status={job.status}
                      compact
                      onUpdated={(next) =>
                        setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: next } : j)))
                      }
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {job.description && (
                    <p className="text-sm text-gray-600 line-clamp-2">{job.description}</p>
                  )}
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    {job.scheduledStart && (
                      <div className="flex items-center text-gray-600">
                        <Calendar className="mr-2 h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Scheduled</p>
                          <p className="font-medium">{formatDate(job.scheduledStart)}</p>
                        </div>
                      </div>
                    )}
                    {job.estimateAmount && (
                      <div className="flex items-center text-gray-600">
                        <DollarSign className="mr-2 h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Estimate</p>
                          <p className="font-medium">{formatCurrency(parseFloat(job.estimateAmount))}</p>
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-gray-500">Priority</p>
                      <p className="font-medium text-gray-700">{priorityLabels[job.priority] || 'Medium'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Crew</p>
                      <p className="font-medium text-gray-700">{job.assignments.length} assigned</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-gray-500">Total Cost</p>
                      <p className="font-semibold text-gray-900">
                        {job.totalCost ? formatCurrency(parseFloat(job.totalCost)) : (job.estimateAmount ? formatCurrency(parseFloat(job.estimateAmount)) : '-')}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Job Open Invoices</p>
                      <p className="font-semibold text-amber-700">
                        {formatCurrency(parseFloat(job.openInvoiceBalance || '0'))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Client Open Balance</p>
                      <p className="font-semibold text-amber-700">
                        {formatCurrency(parseFloat(job.clientOpenInvoiceBalance || '0'))}
                      </p>
                    </div>
                  </div>

                  {job.assignments.length > 0 && (
                    <div className="pt-2 border-t">
                      <p className="text-xs text-gray-500 mb-1">Assigned Team:</p>
                      <div className="flex flex-wrap gap-2">
                        {job.assignments.map((assignment) => (
                          <span key={assignment.id} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                            {assignment.user.firstName} {assignment.user.lastName}
                            {assignment.role && ` (${assignment.role})`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="flex items-center space-x-4 text-xs text-gray-500">
                      {job._count.tasks > 0 && (
                        <span>{job._count.tasks} tasks</span>
                      )}
                      {job._count.issues > 0 && (
                        <span>{job._count.issues} issues</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/dashboard/estimates/new?jobId=${job.id}&clientId=${job.client.id}`)
                        }}
                        className="h-7 px-2 bg-transparent hover:bg-transparent text-[#2E4A59] hover:text-[#2E4A59] border border-[#2E4A59]/30 hover:border-[#2E4A59]"
                        title="New Estimate"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(job.id, job.title)
                        }}
                        disabled={deletingId === job.id}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      ) : viewMode === 'rowCompact' ? (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="relative">
              <input
                type="checkbox"
                checked={selectedIds.includes(job.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => toggleSelected(job.id, e.target.checked)}
                className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2"
                title="Select for duplicate"
              />
              <RowCompactItem
                href={`/dashboard/jobs/${job.id}`}
                primary={`${job.jobNumber} - ${job.title}`}
                secondary={`${job.client.name} | Client Open: ${formatCurrency(parseFloat(job.clientOpenInvoiceBalance || '0'))}`}
                status={
                  <JobStatusSelect
                    jobId={job.id}
                    status={job.status}
                    compact
                    onUpdated={(next) =>
                      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: next } : j)))
                    }
                  />
                }
                amount={job.totalCost ? formatCurrency(parseFloat(job.totalCost)) : (job.estimateAmount ? formatCurrency(parseFloat(job.estimateAmount)) : '-')}
                date={`Open: ${formatCurrency(parseFloat(job.openInvoiceBalance || '0'))}`}
                className="pl-10"
              />
            </div>
          ))}
        </div>
      ) : viewMode === 'rowDetailed' ? (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="relative">
              <input
                type="checkbox"
                checked={selectedIds.includes(job.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => toggleSelected(job.id, e.target.checked)}
                className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2"
                title="Select for duplicate"
              />
              <RowDetailedItem
                href={`/dashboard/jobs/${job.id}`}
                primary={`${job.jobNumber} - ${job.title}`}
                status={
                  <JobStatusSelect
                    jobId={job.id}
                    status={job.status}
                    compact
                    onUpdated={(next) =>
                      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: next } : j)))
                    }
                  />
                }
                line2={`${job.client.name} | Priority ${priorityLabels[job.priority] || 'Medium'} | Client Open ${formatCurrency(parseFloat(job.clientOpenInvoiceBalance || '0'))}`}
                rightTop={job.totalCost ? formatCurrency(parseFloat(job.totalCost)) : (job.estimateAmount ? formatCurrency(parseFloat(job.estimateAmount)) : '-')}
                rightBottom={`Job Open ${formatCurrency(parseFloat(job.openInvoiceBalance || '0'))}`}
                className="pl-10"
              />
            </div>
          ))}
        </div>
      ) : (
        <TableView
          data={jobs}
          rowKey={(job) => job.id}
          onRowClick={(job) => router.push(`/dashboard/jobs/${job.id}`)}
          columns={[
            {
              key: 'select',
              header: '',
              render: (job) => (
                <input
                  type="checkbox"
                  checked={selectedIds.includes(job.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => toggleSelected(job.id, e.target.checked)}
                  className="h-4 w-4"
                  title="Select for duplicate"
                />
              ),
              className: 'w-10',
              headerClassName: 'w-10',
            },
            {
              key: 'job',
              header: 'Job',
              sortValue: (job) => `${job.jobNumber} ${job.title}`,
              render: (job) => <span className="font-medium">{job.jobNumber} - {job.title}</span>,
            },
            {
              key: 'client',
              header: 'Client',
              sortValue: (job) => job.client.name,
              render: (job) => job.client.name,
            },
            {
              key: 'status',
              header: 'Status',
              sortValue: (job) => job.status,
              render: (job) => (
                <JobStatusSelect
                  jobId={job.id}
                  status={job.status}
                  compact
                  onUpdated={(next) =>
                    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: next } : j)))
                  }
                />
              ),
            },
            {
              key: 'estimate',
              header: 'Total Cost',
              sortValue: (job) => Number(job.totalCost || job.estimateAmount || 0),
              render: (job) => (job.totalCost ? formatCurrency(parseFloat(job.totalCost)) : (job.estimateAmount ? formatCurrency(parseFloat(job.estimateAmount)) : '-')),
            },
            {
              key: 'jobOpen',
              header: 'Job Open',
              sortValue: (job) => Number(job.openInvoiceBalance || 0),
              render: (job) => <span className="font-medium text-amber-700">{formatCurrency(parseFloat(job.openInvoiceBalance || '0'))}</span>,
            },
            {
              key: 'clientOpen',
              header: 'Client Open',
              sortValue: (job) => Number(job.clientOpenInvoiceBalance || 0),
              render: (job) => <span className="font-medium text-amber-700">{formatCurrency(parseFloat(job.clientOpenInvoiceBalance || '0'))}</span>,
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (job) => (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(`/dashboard/estimates/new?jobId=${job.id}&clientId=${job.client.id}`)
                    }}
                    className="h-7 px-2 bg-transparent hover:bg-transparent text-[#2E4A59] hover:text-[#2E4A59] border border-[#2E4A59]/30 hover:border-[#2E4A59]"
                    title="New Estimate"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(job.id, job.title)
                    }}
                    disabled={deletingId === job.id}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}

      <PaginationControls
        page={page}
        totalPages={totalPages}
        total={total}
        disabled={isFetching}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />
        </>
      )}
    </div>
  )
}
