'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime } from '@/lib/utils'
import { Plus, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, addWeeks, subWeeks, addMonths, subMonths, addDays, subDays, isSameDay, isToday } from 'date-fns'

interface Schedule {
  id: string
  title: string
  description: string | null
  type: string
  startTime: string
  endTime: string
  allDay: boolean
  user: {
    id: string
    firstName: string
    lastName: string
    email: string
  }
  job: {
    id: string
    jobNumber: string
    title: string
    status: string
    client: {
      name: string
    }
  } | null
  lead: {
    id: string
    firstName: string
    lastName: string
  } | null
}

interface TeamMember {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  _count: {
    schedules: number
  }
}

export default function SchedulePage() {
  const router = useRouter()
  const [view, setView] = useState<'day' | 'week' | 'month'>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [selectedUserId, setSelectedUserId] = useState('all')
  const [loading, setLoading] = useState(true)
  const [conflicts, setConflicts] = useState<string[]>([])

  useEffect(() => {
    fetchTeamMembers()
  }, [])

  useEffect(() => {
    fetchSchedules()
  }, [view, currentDate, selectedUserId])

  const fetchTeamMembers = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch('/api/schedules/team', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setTeamMembers(data.teamMembers || [])
      }
    } catch (error) {
      console.error('Failed to fetch team members:', error)
    }
  }

  const fetchSchedules = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('accessToken')

      let start: Date
      let end: Date

      switch (view) {
        case 'day':
          start = new Date(currentDate)
          start.setHours(0, 0, 0, 0)
          end = new Date(currentDate)
          end.setHours(23, 59, 59, 999)
          break
        case 'week':
          start = startOfWeek(currentDate, { weekStartsOn: 1 })
          end = endOfWeek(currentDate, { weekStartsOn: 1 })
          break
        case 'month':
          start = startOfMonth(currentDate)
          end = endOfMonth(currentDate)
          break
      }

      const params = new URLSearchParams({
        view,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        userId: selectedUserId,
      })

      const response = await fetch(`/api/schedules?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      const data = await response.json()
      setSchedules(data.schedules || [])
      setConflicts(data.conflicts || [])
    } catch (error) {
      console.error('Failed to fetch schedules:', error)
    } finally {
      setLoading(false)
    }
  }

  const navigateDate = (direction: 'prev' | 'next') => {
    switch (view) {
      case 'day':
        setCurrentDate(direction === 'next' ? addDays(currentDate, 1) : subDays(currentDate, 1))
        break
      case 'week':
        setCurrentDate(direction === 'next' ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1))
        break
      case 'month':
        setCurrentDate(direction === 'next' ? addMonths(currentDate, 1) : subMonths(currentDate, 1))
        break
    }
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  // Generate calendar grid for week view
  const generateWeekDays = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  }

  const getSchedulesForDate = (date: Date) => {
    return schedules.filter((schedule) => {
      const scheduleDate = new Date(schedule.startTime)
      return isSameDay(scheduleDate, date)
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading schedule...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Schedule</h1>
          <p className="mt-2 text-gray-600">Manage team schedules and appointments</p>
        </div>
        <Button onClick={() => router.push('/dashboard/schedule/new')}>
          <Plus className="mr-2 h-4 w-4" />
          New Schedule
        </Button>
      </div>

      {/* View Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={() => navigateDate('prev')}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToToday}>
                Today
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigateDate('next')}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="ml-4">
                <h2 className="text-lg font-semibold">
                  {view === 'day' && format(currentDate, 'EEEE, MMMM d, yyyy')}
                  {view === 'week' && `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'MMM d')} - ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`}
                  {view === 'month' && format(currentDate, 'MMMM yyyy')}
                </h2>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Team</option>
                {teamMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.firstName} {member.lastName}
                  </option>
                ))}
              </select>
              <div className="flex items-center space-x-1 border rounded-md">
                <button
                  onClick={() => setView('day')}
                  className={`px-3 py-2 text-sm ${view === 'day' ? 'bg-primary text-white' : 'bg-white text-gray-700'}`}
                >
                  Day
                </button>
                <button
                  onClick={() => setView('week')}
                  className={`px-3 py-2 text-sm border-l ${view === 'week' ? 'bg-primary text-white' : 'bg-white text-gray-700'}`}
                >
                  Week
                </button>
                <button
                  onClick={() => setView('month')}
                  className={`px-3 py-2 text-sm border-l ${view === 'month' ? 'bg-primary text-white' : 'bg-white text-gray-700'}`}
                >
                  Month
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conflicts Warning */}
      {conflicts.length > 0 && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-yellow-800">
              <CalendarIcon className="h-5 w-5" />
              <p className="font-medium">Schedule conflicts detected! Please review overlapping appointments.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Calendar View */}
      {view === 'week' && (
        <div className="grid grid-cols-7 gap-4">
          {generateWeekDays().map((day) => {
            const daySchedules = getSchedulesForDate(day)
            const isCurrentDay = isToday(day)

            return (
              <Card key={day.toISOString()} className={isCurrentDay ? 'border-blue-500' : ''}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    {format(day, 'EEE')}
                  </CardTitle>
                  <CardDescription className={`text-lg font-bold ${isCurrentDay ? 'text-blue-600' : ''}`}>
                    {format(day, 'd')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 min-h-[200px]">
                    {daySchedules.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No schedules</p>
                    ) : (
                      daySchedules.map((schedule) => {
                        const hasConflict = conflicts.some((c) => c.includes(schedule.id))
                        return (
                          <div
                            key={schedule.id}
                            className={`p-2 rounded text-xs cursor-pointer hover:shadow-md transition-shadow ${
                              hasConflict ? 'bg-red-100 border-red-300 border' :
                              schedule.type === 'JOB' ? 'bg-blue-100 border-blue-300 border' :
                              schedule.type === 'ESTIMATE' ? 'bg-purple-100 border-purple-300 border' :
                              'bg-gray-100 border-gray-300 border'
                            }`}
                            onClick={() => router.push(`/dashboard/schedule/${schedule.id}`)}
                          >
                            <p className="font-medium truncate">{schedule.title}</p>
                            <p className="text-gray-600">
                              {schedule.allDay ? 'All Day' : format(new Date(schedule.startTime), 'h:mm a')}
                            </p>
                            <p className="text-gray-500 truncate">
                              {schedule.user.firstName} {schedule.user.lastName}
                            </p>
                            {schedule.job && (
                              <p className="text-gray-500 truncate">
                                {schedule.job.client.name}
                              </p>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Day View */}
      {view === 'day' && (
        <Card>
          <CardHeader>
            <CardTitle>{format(currentDate, 'EEEE, MMMM d, yyyy')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {getSchedulesForDate(currentDate).length === 0 ? (
                <p className="text-center text-gray-500 py-8">No schedules for this day</p>
              ) : (
                getSchedulesForDate(currentDate).map((schedule) => (
                  <div
                    key={schedule.id}
                    className="p-4 border rounded-lg hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => router.push(`/dashboard/schedule/${schedule.id}`)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold">{schedule.title}</h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {formatDateTime(schedule.startTime)} - {formatDateTime(schedule.endTime)}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          {schedule.user.firstName} {schedule.user.lastName}
                        </p>
                        {schedule.job && (
                          <p className="text-sm text-blue-600 mt-1">
                            Job {schedule.job.jobNumber} • {schedule.job.client.name}
                          </p>
                        )}
                        {schedule.description && (
                          <p className="text-sm text-gray-600 mt-2">{schedule.description}</p>
                        )}
                      </div>
                      <span className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-800">
                        {schedule.type}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Month View - Simplified */}
      {view === 'month' && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <div key={day} className="text-center text-sm font-medium text-gray-500">
                  {day}
                </div>
              ))}
            </div>
            <div className="text-center text-gray-500 py-8">
              Month view grid implementation coming soon. Use week or day view for detailed scheduling.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
