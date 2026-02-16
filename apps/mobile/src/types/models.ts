export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  tenantId: string
  tenantName?: string
}

export interface ApiError {
  error: string
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface Job {
  id: string
  jobNumber: string
  title: string
  description?: string | null
  status: string
  priority: string
  scheduledStart: string | null
  scheduledEnd: string | null
  createdAt?: string
  client?: {
    id: string
    name: string
    phone?: string | null
    email?: string | null
  } | null
  address?: {
    street?: string | null
    city?: string | null
    state?: string | null
    zipCode?: string | null
  } | null
  assignedTo?: {
    id: string
    firstName: string
    lastName: string
  } | null
}

export interface Task {
  id: string
  title: string
  description?: string | null
  status: string
  priority: string
  dueDate?: string | null
  assigneeId?: string | null
  jobId?: string | null
  createdAt: string
}

export interface Issue {
  id: string
  title: string
  description?: string | null
  type: string
  status: string
  priority: string
  assigneeId?: string | null
  jobId?: string | null
  createdAt: string
}

export interface ScheduleItem {
  id: string
  title: string
  type: string
  startTime: string
  endTime: string
  allDay: boolean
  job?: {
    id: string
    jobNumber: string
    title: string
  } | null
}

export interface Conversation {
  id: string
  channel: string
  status: string
  unreadCount: number
  participants: string[]
  lastMessageAt: string | null
  client?: {
    id: string
    name: string
    phone?: string | null
    email?: string | null
  } | null
  messages?: Array<{
    id: string
    body: string
    direction: string
    createdAt: string
  }>
}

export interface Attachment {
  id: string
  fileName: string
  url: string
  mimeType: string
  fileSize: number
  createdAt: string
}

