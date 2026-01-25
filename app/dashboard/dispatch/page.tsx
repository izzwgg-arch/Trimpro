'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar, Clock, MapPin, Users, Filter, Plus, X } from 'lucide-react'
import { formatDate, formatTime } from '@/lib/utils'
import { PermissionButton } from '@/components/permissions/PermissionButton'

interface Job {
  id: string
  jobNumber: string
  title: string
  status: string
  priority: string
  scheduledStart: string | null
  scheduledEnd: string | null
  assignedTo: {
    id: string
    firstName: string
    lastName: string
  } | null
  client: {
    id: string
    name: string
  }
  jobSite: {
    street: string
    city: string
    state: string
    zipCode: string
  } | null
}

interface Tech {
  id: string
  firstName: string
  lastName: string
  email: string
  isAvailable: boolean
}

export default function DispatchPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [techs, setTechs] = useState<Tech[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'board' | 'calendar'>('board')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [showFilters, setShowFilters] = useState(false)
  const [showNewAssignment, setShowNewAssignment] = useState(false)
  const [filters, setFilters] = useState({
    status: 'all',
    priority: 'all',
    search: '',
  })

  useEffect(() => {
    fetchData()
  }, [selectedDate])

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        window.location.href = '/auth/login'
        return
      }

      // Fetch unassigned and assigned jobs
      const jobsResponse = await fetch(`/api/dispatch/jobs?date=${selectedDate}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (jobsResponse.ok) {
        const jobsData = await jobsResponse.json()
        setJobs(jobsData.jobs || [])
      }

      // Fetch available technicians
      const techsResponse = await fetch('/api/dispatch/techs', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (techsResponse.ok) {
        const techsData = await techsResponse.json()
        setTechs(techsData.techs || [])
      }
    } catch (error) {
      console.error('Failed to fetch dispatch data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAssignJob = async (jobId: string, techId: string | null) => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/dispatch/assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jobId,
          techId,
        }),
      })

      if (response.ok) {
        fetchData() // Refresh data
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to assign job')
      }
    } catch (error) {
      console.error('Failed to assign job:', error)
      alert('Failed to assign job')
    }
  }

  const handleStatusUpdate = async (jobId: string, status: string) => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/dispatch/jobs/${jobId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      })

      if (response.ok) {
        fetchData() // Refresh data
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to update job status')
      }
    } catch (error) {
      console.error('Failed to update job status:', error)
      alert('Failed to update job status')
    }
  }

  const handleNewAssignment = async (jobId: string, techId: string, scheduledStart?: string) => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/dispatch/assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jobId,
          techId,
          scheduledStart,
        }),
      })

      if (response.ok) {
        setShowNewAssignment(false)
        fetchData() // Refresh data
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to create assignment')
      }
    } catch (error) {
      console.error('Failed to create assignment:', error)
      alert('Failed to create assignment')
    }
  }

  // Apply filters
  const filteredJobs = jobs.filter((job) => {
    if (filters.status !== 'all' && job.status !== filters.status) return false
    if (filters.priority !== 'all' && job.priority !== filters.priority) return false
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      if (
        !job.jobNumber.toLowerCase().includes(searchLower) &&
        !job.title.toLowerCase().includes(searchLower) &&
        !job.client.name.toLowerCase().includes(searchLower)
      ) {
        return false
      }
    }
    return true
  })

  const unassignedJobs = filteredJobs.filter((j) => !j.assignedTo && j.status !== 'COMPLETED' && j.status !== 'CANCELLED')
  const assignedJobs = filteredJobs.filter((j) => j.assignedTo)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading dispatch board...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dispatch Board</h1>
          <p className="text-gray-600 mt-1">Manage job assignments and scheduling</p>
        </div>
        <div className="flex items-center gap-2">
          <PermissionButton
            variant="outline"
            permission="dispatch.view"
            onClick={() => setShowFilters(true)}
          >
            <Filter className="mr-2 h-4 w-4" />
            Filters
          </PermissionButton>

          <PermissionButton
            permission="dispatch.assign"
            onClick={() => setShowNewAssignment(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Assignment
          </PermissionButton>

          <Dialog open={showFilters} onOpenChange={setShowFilters}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Filter Jobs</DialogTitle>
                <DialogDescription>Filter jobs by status, priority, or search term</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label htmlFor="filter-status">Status</Label>
                  <Select
                    value={filters.status}
                    onValueChange={(value) => setFilters({ ...filters, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="QUOTE">Quote</SelectItem>
                      <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                      <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                      <SelectItem value="COMPLETED">Completed</SelectItem>
                      <SelectItem value="CANCELLED">Cancelled</SelectItem>
                      <SelectItem value="ON_HOLD">On Hold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="filter-priority">Priority</Label>
                  <Select
                    value={filters.priority}
                    onValueChange={(value) => setFilters({ ...filters, priority: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Priorities</SelectItem>
                      <SelectItem value="LOW">Low</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="URGENT">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="filter-search">Search</Label>
                  <Input
                    id="filter-search"
                    placeholder="Search by job number, title, or client..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFilters({ status: 'all', priority: 'all', search: '' })
                    }}
                  >
                    Clear
                  </Button>
                  <Button onClick={() => setShowFilters(false)}>Apply</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showNewAssignment} onOpenChange={setShowNewAssignment}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Assignment</DialogTitle>
                <DialogDescription>Assign a job to a technician</DialogDescription>
              </DialogHeader>
              <NewAssignmentForm
                jobs={unassignedJobs}
                techs={techs}
                onAssign={handleNewAssignment}
                onClose={() => setShowNewAssignment(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Date Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700">Date:</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <Button
                variant={view === 'board' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setView('board')}
              >
                Board View
              </Button>
              <Button
                variant={view === 'calendar' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setView('calendar')}
              >
                Calendar View
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dispatch Board */}
      {view === 'board' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Unassigned Jobs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Unassigned ({unassignedJobs.length})
              </CardTitle>
              <CardDescription>Jobs waiting for assignment</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {unassignedJobs.length === 0 ? (
                  <p className="text-center text-gray-500 py-8 text-sm">No unassigned jobs</p>
                ) : (
                  unassignedJobs.map((job) => (
                    <div
                      key={job.id}
                      className="p-4 border border-gray-200 rounded-lg hover:border-blue-500 transition-colors cursor-pointer group"
                      onClick={() => {
                        // Show assignment options
                        if (techs.length === 0) {
                          alert('No technicians available')
                          return
                        }
                        const techOptions = techs.map((t, idx) => `${idx + 1}. ${t.firstName} ${t.lastName}`).join('\n')
                        const selection = prompt(`Assign to:\n${techOptions}\n\nEnter number (or 0 to unassign):`)
                        if (selection !== null) {
                          const idx = parseInt(selection) - 1
                          if (idx === -1) {
                            handleAssignJob(job.id, null)
                          } else if (idx >= 0 && idx < techs.length) {
                            handleAssignJob(job.id, techs[idx].id)
                          }
                        }
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-sm">{job.jobNumber}</p>
                          <p className="text-xs text-gray-600 mt-1">{job.title}</p>
                          <p className="text-xs text-gray-500 mt-1">{job.client.name}</p>
                          {job.jobSite && (
                            <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                              <MapPin className="h-3 w-3" />
                              {job.jobSite.city}, {job.jobSite.state}
                            </div>
                          )}
                        </div>
                        <span
                          className={`px-2 py-1 text-xs rounded ${
                            job.priority === 'HIGH'
                              ? 'bg-red-100 text-red-800'
                              : job.priority === 'MEDIUM'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {job.priority}
                        </span>
                      </div>
                      {job.scheduledStart && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                          <Calendar className="h-3 w-3" />
                          {formatDate(job.scheduledStart)}
                          {job.scheduledStart && (
                            <>
                              {' '}
                              <Clock className="h-3 w-3 ml-2" />
                              {formatTime(job.scheduledStart)}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Assigned Jobs by Tech */}
          <div className="lg:col-span-2 space-y-6">
            {techs.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-center text-gray-500 py-8">No technicians available</p>
                </CardContent>
              </Card>
            ) : (
              techs.map((tech) => {
                const techJobs = assignedJobs.filter((j) => j.assignedTo?.id === tech.id)
                return (
                  <Card key={tech.id}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        {tech.firstName} {tech.lastName}
                        <span className="text-sm font-normal text-gray-500">
                          ({techJobs.length} {techJobs.length === 1 ? 'job' : 'jobs'})
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {techJobs.length === 0 ? (
                        <p className="text-center text-gray-500 py-4 text-sm">No jobs assigned</p>
                      ) : (
                        <div className="space-y-3">
                          {techJobs.map((job) => (
                            <div
                              key={job.id}
                              className="p-4 border border-gray-200 rounded-lg bg-blue-50 group relative"
                            >
                              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (confirm('Unassign this job?')) {
                                      handleAssignJob(job.id, null)
                                    }
                                  }}
                                >
                                  Unassign
                                </Button>
                              </div>
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <p className="font-medium text-sm">{job.jobNumber}</p>
                                  <p className="text-xs text-gray-600 mt-1">{job.title}</p>
                                  <p className="text-xs text-gray-500 mt-1">{job.client.name}</p>
                                  {job.jobSite && (
                                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                                      <MapPin className="h-3 w-3" />
                                      {job.jobSite.city}, {job.jobSite.state}
                                    </div>
                                  )}
                                </div>
                                <span
                                  className={`px-2 py-1 text-xs rounded ${
                                    job.status === 'IN_PROGRESS'
                                      ? 'bg-green-100 text-green-800'
                                      : job.status === 'SCHEDULED'
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-gray-100 text-gray-800'
                                  }`}
                                >
                                  {job.status}
                                </span>
                              </div>
                              {job.scheduledStart && (
                                <div className="flex items-center gap-1 mt-2 text-xs text-gray-600">
                                  <Calendar className="h-3 w-3" />
                                  {formatDate(job.scheduledStart)}
                                  {job.scheduledStart && (
                                    <>
                                      {' '}
                                      <Clock className="h-3 w-3 ml-2" />
                                      {formatTime(job.scheduledStart)}
                                    </>
                                  )}
                                </div>
                              )}
                              <div className="flex gap-2 mt-3">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleStatusUpdate(job.id, 'IN_PROGRESS')
                                  }}
                                  disabled={job.status === 'IN_PROGRESS'}
                                >
                                  Start
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleStatusUpdate(job.id, 'COMPLETED')
                                  }}
                                  disabled={job.status === 'COMPLETED'}
                                >
                                  Complete
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Calendar View */}
      {view === 'calendar' && (
        <Card>
          <CardHeader>
            <CardTitle>Calendar View</CardTitle>
            <CardDescription>Timeline view of all scheduled jobs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center text-gray-500 py-12">
              <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p>Calendar view coming soon</p>
              <p className="text-sm mt-2">Use Board View to manage assignments</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

interface NewAssignmentFormProps {
  jobs: Job[]
  techs: Tech[]
  onAssign: (jobId: string, techId: string, scheduledStart?: string) => void
  onClose: () => void
}

function NewAssignmentForm({ jobs, techs, onAssign, onClose }: NewAssignmentFormProps) {
  const [selectedJobId, setSelectedJobId] = useState<string>('')
  const [selectedTechId, setSelectedTechId] = useState<string>('')
  const [scheduledStart, setScheduledStart] = useState<string>('')
  const [scheduledEnd, setScheduledEnd] = useState<string>('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedJobId || !selectedTechId) {
      alert('Please select both a job and a technician')
      return
    }
    onAssign(selectedJobId, selectedTechId, scheduledStart || undefined)
  }

  if (jobs.length === 0) {
    return (
      <div className="py-4">
        <p className="text-center text-gray-500">No unassigned jobs available</p>
        <div className="flex justify-end pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  if (techs.length === 0) {
    return (
      <div className="py-4">
        <p className="text-center text-gray-500">No technicians available</p>
        <div className="flex justify-end pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 py-4">
      <div>
        <Label htmlFor="assignment-job">Job *</Label>
        <Select value={selectedJobId} onValueChange={setSelectedJobId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a job" />
          </SelectTrigger>
          <SelectContent>
            {jobs.map((job) => (
              <SelectItem key={job.id} value={job.id}>
                {job.jobNumber} - {job.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="assignment-tech">Technician *</Label>
        <Select value={selectedTechId} onValueChange={setSelectedTechId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a technician" />
          </SelectTrigger>
          <SelectContent>
            {techs.map((tech) => (
              <SelectItem key={tech.id} value={tech.id}>
                {tech.firstName} {tech.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="assignment-start">Scheduled Start (Optional)</Label>
        <Input
          id="assignment-start"
          type="datetime-local"
          value={scheduledStart}
          onChange={(e) => setScheduledStart(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="assignment-end">Scheduled End (Optional)</Label>
        <Input
          id="assignment-end"
          type="datetime-local"
          value={scheduledEnd}
          onChange={(e) => setScheduledEnd(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!selectedJobId || !selectedTechId}>
          Assign
        </Button>
      </div>
    </form>
  )
}
