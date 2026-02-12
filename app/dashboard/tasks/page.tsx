'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/utils'
import { Plus, Search, Filter, CheckSquare, Calendar, User, AlertCircle } from 'lucide-react'
import Link from 'next/link'

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  dueDate: string | null
  completedAt: string | null
  assignee: {
    id: string
    firstName: string
    lastName: string
    email: string
  }
  creator: {
    firstName: string
    lastName: string
  }
  client: {
    id: string
    name: string
  } | null
  job: {
    id: string
    jobNumber: string
    title: string
  } | null
  invoice: {
    id: string
    invoiceNumber: string
  } | null
  issue: {
    id: string
    title: string
  } | null
  subtasks: Array<{
    id: string
    title: string
    isCompleted: boolean
  }>
  _count: {
    subtasks: number
  }
}

const statusColors: Record<string, string> = {
  TODO: 'bg-gray-100 text-gray-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

const priorityColors: Record<string, string> = {
  LOW: 'text-gray-600',
  MEDIUM: 'text-blue-600',
  HIGH: 'text-orange-600',
  URGENT: 'text-red-600',
}

export default function TasksPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [filter, setFilter] = useState('all') // all, my, assigned

  useEffect(() => {
    const statusParam = searchParams.get('status')
    if (statusParam) {
      setStatus(statusParam)
    }
  }, [searchParams])

  useEffect(() => {
    fetchTasks()
  }, [search, status, filter])

  const fetchTasks = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const params = new URLSearchParams({
        search,
        status,
        filter,
        page: '1',
        limit: '50',
      })

      const response = await fetch(`/api/tasks?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      const data = await response.json()
      setTasks(data.tasks || [])
    } catch (error) {
      console.error('Failed to fetch tasks:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading tasks...</p>
        </div>
      </div>
    )
  }

  const overdueTasks = tasks.filter(
    (task) => task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'COMPLETED'
  )
  const todayTasks = tasks.filter(
    (task) => task.dueDate && new Date(task.dueDate).toDateString() === new Date().toDateString() && task.status !== 'COMPLETED'
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Tasks</h1>
          <p className="mt-2 text-gray-600">Manage your tasks and to-dos</p>
        </div>
        <Button onClick={() => router.push('/dashboard/tasks/new')}>
          <Plus className="mr-2 h-4 w-4" />
          New Task
        </Button>
      </div>

      {/* Summary Cards */}
      {(overdueTasks.length > 0 || todayTasks.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {overdueTasks.length > 0 && (
            <Card className="border-red-300 bg-red-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-red-900 flex items-center">
                  <AlertCircle className="mr-2 h-4 w-4" />
                  Overdue Tasks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{overdueTasks.length}</div>
                <p className="text-xs text-red-700 mt-1">Requires immediate attention</p>
              </CardContent>
            </Card>
          )}
          {todayTasks.length > 0 && (
            <Card className="border-blue-300 bg-blue-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-blue-900 flex items-center">
                  <Calendar className="mr-2 h-4 w-4" />
                  Due Today
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">{todayTasks.length}</div>
                <p className="text-xs text-blue-700 mt-1">Due today</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search tasks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Tasks</option>
                <option value="my">My Tasks</option>
                <option value="assigned">Assigned to Me</option>
              </select>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Status</option>
                <option value="PLANNING_PENDING">Planning / Pending</option>
                <option value="TODO">To Do</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tasks List */}
      <div className="space-y-4">
        {tasks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <CheckSquare className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No tasks</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by creating a new task.
              </p>
              <div className="mt-6">
                <Button onClick={() => router.push('/dashboard/tasks/new')}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Task
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          tasks.map((task) => {
            const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'COMPLETED'
            const completedSubtasks = task.subtasks.filter((st) => st.isCompleted).length
            
            return (
              <Card
                key={task.id}
                className={`hover:shadow-lg transition-shadow ${
                  isOverdue ? 'border-red-300' : ''
                } ${task.status === 'COMPLETED' ? 'opacity-60' : ''}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <Link href={`/dashboard/tasks/${task.id}`}>
                        <CardTitle className="text-lg hover:text-primary cursor-pointer flex items-center">
                          {task.status === 'COMPLETED' && (
                            <CheckSquare className="mr-2 h-4 w-4 text-green-600" />
                          )}
                          {task.title}
                        </CardTitle>
                      </Link>
                      <CardDescription className="mt-1">
                        Assigned to {task.assignee.firstName} {task.assignee.lastName}
                        {task.client && ` • ${task.client.name}`}
                        {task.job && ` • Job ${task.job.jobNumber}`}
                        {task.invoice && ` • Invoice ${task.invoice.invoiceNumber}`}
                        {task.issue && ` • Issue: ${task.issue.title}`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                      {isOverdue && (
                        <AlertCircle className="h-5 w-5 text-red-500" />
                      )}
                      <span className={`px-2 py-1 text-xs rounded-full ${statusColors[task.status] || 'bg-gray-100 text-gray-800'}`}>
                        {task.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {task.description && (
                      <p className="text-sm text-gray-600 line-clamp-2">{task.description}</p>
                    )}

                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center space-x-4">
                        <span className={`font-medium ${priorityColors[task.priority] || 'text-gray-600'}`}>
                          {task.priority}
                        </span>
                        {task.dueDate && (
                          <div className="flex items-center text-gray-600">
                            <Calendar className="mr-1 h-3 w-3" />
                            <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
                              {formatDate(task.dueDate)}
                            </span>
                          </div>
                        )}
                        {task._count.subtasks > 0 && (
                          <span className="text-gray-500">
                            {completedSubtasks}/{task._count.subtasks} subtasks
                          </span>
                        )}
                      </div>
                    </div>

                    {task.subtasks.length > 0 && (
                      <div className="pt-2 border-t">
                        <div className="space-y-1">
                          {task.subtasks.slice(0, 3).map((subtask) => (
                            <div key={subtask.id} className="flex items-center text-xs">
                              <CheckSquare
                                className={`mr-2 h-3 w-3 ${
                                  subtask.isCompleted ? 'text-green-600' : 'text-gray-400'
                                }`}
                              />
                              <span
                                className={
                                  subtask.isCompleted ? 'line-through text-gray-400' : 'text-gray-600'
                                }
                              >
                                {subtask.title}
                              </span>
                            </div>
                          ))}
                          {task.subtasks.length > 3 && (
                            <p className="text-xs text-gray-400 ml-5">
                              +{task.subtasks.length - 3} more
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
