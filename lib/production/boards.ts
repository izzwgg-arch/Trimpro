// Fixed status columns for the Tasks and Leads production-line boards.
// (The Jobs board columns come from the tenant ProductionSettings config.)

export interface BoardColumnDef {
  id: string // the status value
  label: string
  color: string // hex, for the column header
  icon: string // lucide / ionicons-friendly key
}

export const TASK_BOARD_COLUMNS: BoardColumnDef[] = [
  { id: 'TODO', label: 'To Do', color: '#64748b', icon: 'Circle' },
  { id: 'IN_PROGRESS', label: 'In Progress', color: '#eab308', icon: 'PlayCircle' },
  { id: 'COMPLETED', label: 'Completed', color: '#22c55e', icon: 'CheckCircle' },
]

export const LEAD_BOARD_COLUMNS: BoardColumnDef[] = [
  { id: 'NEW', label: 'New', color: '#3b82f6', icon: 'Flag' },
  { id: 'CONTACTED', label: 'Contacted', color: '#0ea5e9', icon: 'PlayCircle' },
  { id: 'QUALIFIED', label: 'Qualified', color: '#6366f1', icon: 'CheckCircle' },
  { id: 'ESTIMATE_CREATED', label: 'Estimate Created', color: '#8b5cf6', icon: 'Ruler' },
  { id: 'ESTIMATE_SENT', label: 'Estimate Sent', color: '#a855f7', icon: 'Truck' },
  { id: 'FOLLOW_UP', label: 'Follow Up', color: '#d97706', icon: 'Clock' },
  { id: 'CONVERTED', label: 'Converted', color: '#16a34a', icon: 'CheckCircle' },
  { id: 'LOST', label: 'Lost', color: '#ef4444', icon: 'AlertCircle' },
]
