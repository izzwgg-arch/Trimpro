'use client'
import { EntityBackButton } from '@/components/navigation/EntityBackButton'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Save } from 'lucide-react'
import { JobContentVisibility, type JobVisibilityValue } from '@/components/schedule/JobContentVisibility'
import { DraftChecklistEditor } from '@/components/lists/DraftChecklistEditor'

interface User {
  id: string
  firstName: string
  lastName: string
}

interface Job {
  id: string
  jobNumber: string
  title: string
}

// <input type="datetime-local"> works in the browser's local time without a zone;
// convert both ways so the server always gets a real instant.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToIso(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString()
}

/** Create a schedule, or edit one when `scheduleId` is given. */
export function ScheduleForm({ scheduleId, initialJobId }: { scheduleId?: string; initialJobId?: string | null }) {
  const router = useRouter()
  const isEdit = Boolean(scheduleId)
  const [loading, setLoading] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(isEdit)
  const [users, setUsers] = useState<User[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  // null = not available (no job chosen, or no permission to choose what is shared)
  const [visibility, setVisibility] = useState<JobVisibilityValue | null>(null)
  // What was saved on the schedule being edited (for the picker's starting state).
  const [savedVisibility, setSavedVisibility] = useState<{ jobId: string; value: JobVisibilityValue } | null>(null)
  const [checklist, setChecklist] = useState<string[]>([])
  const [jobCrew, setJobCrew] = useState<User[]>([])
  const [siteManagerId, setSiteManagerId] = useState('')
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'OTHER',
    startTime: '',
    endTime: '',
    allDay: false,
    userId: '',
    jobId: initialJobId || '',
  })

  useEffect(() => {
    fetchUsers()
    fetchJobs()
  }, [])

  // When a job is chosen, load its crew so a site manager can be picked from it.
  useEffect(() => {
    if (!formData.jobId) {
      setJobCrew([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const res = await fetch(`/api/jobs/${formData.jobId}/assignments`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          if (!cancelled) setJobCrew([])
          return
        }
        const data = await res.json()
        const crew: User[] = (data.assignments || [])
          .filter((a: any) => a?.user?.id)
          .map((a: any) => ({ id: a.user.id, firstName: a.user.firstName, lastName: a.user.lastName }))
        if (!cancelled) setJobCrew(crew)
      } catch {
        if (!cancelled) setJobCrew([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [formData.jobId])

  useEffect(() => {
    if (!scheduleId) return
    ;(async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const res = await fetch(`/api/schedules/${scheduleId}`, { headers: { Authorization: `Bearer ${token}` } })
        if (res.status === 401) {
          router.push('/auth/login')
          return
        }
        const data = await res.json()
        if (!res.ok || !data.schedule) {
          alert(data.error || 'Failed to load schedule')
          return
        }
        const s = data.schedule
        setFormData({
          title: s.title || '',
          description: s.description || '',
          type: s.type || 'OTHER',
          startTime: isoToLocalInput(s.startTime),
          endTime: isoToLocalInput(s.endTime),
          allDay: Boolean(s.allDay),
          userId: s.userId || '',
          jobId: s.jobId || '',
        })
        setSiteManagerId(s.siteManagerId || '')
        if (s.jobId) {
          setSavedVisibility({
            jobId: s.jobId,
            value: {
              restrictContent: Boolean(s.restrictContent),
              attachmentIds: s.visibleAttachmentIds || [],
              noteIds: s.visibleNoteIds || [],
            },
          })
        }
      } catch (error) {
        console.error('Error loading schedule:', error)
        alert('Failed to load schedule')
      } finally {
        setLoadingExisting(false)
      }
    })()
  }, [router, scheduleId])

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

  const fetchJobs = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/jobs?limit=1000', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setJobs(data.jobs || [])
      }
    } catch (error) {
      console.error('Error fetching jobs:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(isEdit ? `/api/schedules/${scheduleId}` : '/api/schedules', {
        method: isEdit ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          startTime: localInputToIso(formData.startTime),
          endTime: localInputToIso(formData.endTime),
          jobId: formData.jobId || null,
          siteManagerId: siteManagerId || null,
          ...(isEdit ? {} : { checklist: checklist.map((t) => t.trim()).filter(Boolean) }),
          ...(formData.jobId && visibility
            ? {
                restrictContent: visibility.restrictContent,
                visibleAttachmentIds: visibility.attachmentIds,
                visibleNoteIds: visibility.noteIds,
              }
            : {}),
        }),
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        if (error.conflicts) {
          alert(`Schedule conflict detected with: ${error.conflicts.map((c: any) => c.title).join(', ')}`)
        } else {
          alert(error.error || (isEdit ? 'Failed to save schedule' : 'Failed to create schedule'))
        }
        return
      }

      router.push(isEdit ? `/dashboard/schedule/${scheduleId}` : '/dashboard/schedule')
    } catch (error) {
      console.error(isEdit ? 'Error saving schedule:' : 'Error creating schedule:', error)
      alert(isEdit ? 'Failed to save schedule' : 'Failed to create schedule')
    } finally {
      setLoading(false)
    }
  }

  if (loadingExisting) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-gray-600">Loading schedule...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <EntityBackButton fallbackHref={isEdit ? `/dashboard/schedule/${scheduleId}` : '/dashboard/schedule'} />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{isEdit ? 'Edit Schedule' : 'New Schedule'}</h1>
          <p className="mt-2 text-gray-600">{isEdit ? 'Change this schedule entry' : 'Create a new schedule entry'}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Schedule Information</CardTitle>
            <CardDescription>Enter the schedule details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Schedule title"
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
                placeholder="Schedule description..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="type">Type</Label>
                <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                  <SelectTrigger id="type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OTHER">Other</SelectItem>
                    <SelectItem value="JOB">Job</SelectItem>
                    <SelectItem value="MEETING">Meeting</SelectItem>
                    <SelectItem value="APPOINTMENT">Appointment</SelectItem>
                    <SelectItem value="BREAK">Break</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="userId">Assigned To *</Label>
                <Select value={formData.userId} onValueChange={(value) => setFormData({ ...formData, userId: value })}>
                  <SelectTrigger id="userId" className="w-full">
                    <SelectValue placeholder="Select user" />
                  </SelectTrigger>
                  <SelectContent>
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
                <Label htmlFor="startTime">Start Time *</Label>
                <Input
                  id="startTime"
                  type="datetime-local"
                  required
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="endTime">End Time *</Label>
                <Input
                  id="endTime"
                  type="datetime-local"
                  required
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="jobId">Job (Optional)</Label>
              <Select value={formData.jobId || '__none__'} onValueChange={(value) => setFormData({ ...formData, jobId: value === '__none__' ? '' : value })}>
                <SelectTrigger id="jobId" className="w-full">
                  <SelectValue placeholder="Select a job" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select a job</SelectItem>
                  {jobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.jobNumber} - {job.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.jobId && jobCrew.length >= 2 && (
              <div>
                <Label htmlFor="siteManagerId">Site Manager</Label>
                <p className="mb-1 text-xs text-gray-500">This job has several people assigned — pick who runs the site for this visit.</p>
                <Select value={siteManagerId || '__none__'} onValueChange={(v) => setSiteManagerId(v === '__none__' ? '' : v)}>
                  <SelectTrigger id="siteManagerId" className="w-full">
                    <SelectValue placeholder="Choose site manager" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No site manager</SelectItem>
                    {jobCrew.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formData.jobId && (
              <JobContentVisibility
                key={formData.jobId}
                jobId={formData.jobId}
                value={visibility}
                onChange={setVisibility}
                initial={savedVisibility && savedVisibility.jobId === formData.jobId ? savedVisibility.value : undefined}
              />
            )}

            {!isEdit && (
              <div>
                <Label>Checklist (Optional)</Label>
                <p className="mb-2 text-xs text-gray-500">Add items for this visit and drag to order them.</p>
                <DraftChecklistEditor value={checklist} onChange={setChecklist} label="" />
              </div>
            )}

            <div className="flex items-center">
              <input
                type="checkbox"
                id="allDay"
                checked={formData.allDay}
                onChange={(e) => setFormData({ ...formData, allDay: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <Label htmlFor="allDay" className="ml-2">
                All Day Event
              </Label>
            </div>

            <div className="flex justify-end space-x-4">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                <Save className="mr-2 h-4 w-4" />
                {isEdit ? (loading ? 'Saving...' : 'Save Changes') : loading ? 'Creating...' : 'Create Schedule'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
