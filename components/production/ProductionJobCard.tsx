'use client'

import { MapPin, Calendar, User, DollarSign, Package, Clock } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { jobStatusColors, formatJobStatus } from '@/lib/jobs/statuses'
import type { ProductionConfig, ProductionCardFieldKey } from '@/lib/production/config'

export interface ProductionJobCardData {
  id: string
  jobNumber: string
  title: string
  status: string
  priority: number
  jobType?: string | null
  estimateAmount?: string | number | null
  invoiceAmount?: number | null
  billingStatus?: string | null
  poCount?: number | null
  scheduledEnd?: string | null
  createdAt?: string | null
  clientName?: string | null
  address?: string | null
  assignedNames?: string[]
  stage?: string
  nextAction?: string
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isOverdue(scheduledEnd?: string | null): boolean {
  if (!scheduledEnd) return false
  const d = new Date(scheduledEnd)
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now()
}

export function ProductionJobCard({
  job,
  config,
  stageColor,
  onClick,
}: {
  job: ProductionJobCardData
  config: ProductionConfig
  stageColor?: string
  onClick?: () => void
}) {
  const card = config.card
  const density = card.density
  const pad = density === 'compact' ? 'p-2' : density === 'detailed' ? 'p-4' : 'p-3'
  const gap = density === 'compact' ? 'space-y-0.5' : density === 'detailed' ? 'space-y-2' : 'space-y-1'
  const titleSize = density === 'compact' ? 'text-xs' : 'text-sm'
  const metaSize = density === 'compact' ? 'text-[11px]' : 'text-xs'

  // A field renders when its entry is visible AND (for the fields that also have
  // a quick toggle in "Card Design") that toggle is on.
  const fieldVisible = new Map<ProductionCardFieldKey, boolean>()
  for (const f of card.fields) fieldVisible.set(f.key, f.visible)
  const show = (key: ProductionCardFieldKey, toggle = true): boolean => (fieldVisible.get(key) ?? false) && toggle

  const overdue = isOverdue(job.scheduledEnd)
  const borderLeft =
    card.borderStyle === 'left-accent' && card.accentFromStageColor && stageColor
      ? { borderLeft: `3px solid ${stageColor}` }
      : undefined
  const borderClass = card.borderStyle === 'full' ? 'border-2' : 'border'

  // Render fields in the configured order.
  const ordered = [...card.fields].sort((a, b) => a.order - b.order)

  const rows: JSX.Element[] = []
  for (const f of ordered) {
    switch (f.key) {
      case 'jobNumber':
        if (!show('jobNumber')) break
        rows.push(
          <div key="jobNumber" className="flex items-center justify-between">
            <span className={`font-mono font-bold ${card.emphasizeJobNumber ? 'text-blue-700 text-sm' : 'text-gray-700 ' + metaSize}`}>
              {job.jobNumber}
            </span>
            {show('priority') && job.priority >= 4 && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">P{job.priority}</span>
            )}
          </div>
        )
        break
      case 'jobName':
        if (!show('jobName')) break
        rows.push(<div key="jobName" className={`font-semibold text-gray-900 ${titleSize} line-clamp-2`}>{job.title}</div>)
        break
      case 'client':
        if (!show('client') || !job.clientName) break
        rows.push(<div key="client" className={`${metaSize} text-gray-600 truncate`}>{job.clientName}</div>)
        break
      case 'jobSiteAddress':
        if (!show('jobSiteAddress', card.showAddress) || !job.address) break
        rows.push(
          <div key="addr" className={`flex items-center gap-1 ${metaSize} text-gray-500`}>
            <MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{job.address}</span>
          </div>
        )
        break
      case 'jobStatus':
        if (!show('jobStatus', card.showStatusBadge)) break
        rows.push(
          <div key="status" className="flex flex-wrap items-center gap-1">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${jobStatusColors[job.status] || 'bg-gray-100 text-gray-700'}`}>
              {formatJobStatus(job.status)}
            </span>
            {overdue && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Overdue</span>}
          </div>
        )
        break
      case 'productionStage':
        if (!show('productionStage') || !job.stage) break
        rows.push(<div key="stage" className={`${metaSize} text-gray-500`}><span className="font-medium text-gray-600">Stage:</span> {job.stage}</div>)
        break
      case 'nextAction':
        if (!show('nextAction', card.showNextAction) || !job.nextAction || job.nextAction === 'None') break
        rows.push(<div key="next" className={`${metaSize} text-gray-500`}><span className="font-medium text-gray-600">Next:</span> {job.nextAction}</div>)
        break
      case 'assignedUser':
        if (!show('assignedUser', card.showAssignedUser)) break
        rows.push(
          <div key="assigned" className={`flex items-center gap-1 ${metaSize} text-gray-500`}>
            <User className="h-3 w-3 shrink-0" /><span className="truncate">{job.assignedNames?.length ? job.assignedNames.join(', ') : 'Unassigned'}</span>
          </div>
        )
        break
      case 'dueDate':
        if (!show('dueDate', card.showDueDate)) break
        rows.push(
          <div key="due" className={`flex items-center gap-1 ${metaSize} ${overdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
            <Calendar className="h-3 w-3 shrink-0" /> Due {fmtDate(job.scheduledEnd)}
          </div>
        )
        break
      case 'createdDate':
        if (!show('createdDate')) break
        rows.push(<div key="created" className={`flex items-center gap-1 ${metaSize} text-gray-400`}><Clock className="h-3 w-3 shrink-0" /> Created {fmtDate(job.createdAt)}</div>)
        break
      case 'jobType':
        if (!show('jobType') || !job.jobType) break
        rows.push(<div key="jobType" className={`${metaSize} text-gray-500`}>{String(job.jobType).replace(/_/g, ' ')}</div>)
        break
      case 'estimateAmount': {
        if (!show('estimateAmount')) break
        const amt = job.estimateAmount != null ? Number(job.estimateAmount) : 0
        if (!amt) break
        rows.push(<div key="est" className={`flex items-center gap-1 ${metaSize} font-semibold text-gray-700`}><DollarSign className="h-3 w-3 shrink-0" />{formatCurrency(amt)}</div>)
        break
      }
      case 'invoiceAmount': {
        if (!show('invoiceAmount') || job.invoiceAmount == null) break
        rows.push(<div key="inv" className={`${metaSize} text-gray-600`}>Invoiced: {formatCurrency(Number(job.invoiceAmount))}</div>)
        break
      }
      case 'billingStatus':
        if (!show('billingStatus') || !job.billingStatus) break
        rows.push(<div key="bill" className={`${metaSize} text-gray-600`}>Billing: {job.billingStatus}</div>)
        break
      case 'purchaseOrder':
        if (!show('purchaseOrder') || !job.poCount) break
        rows.push(<div key="po" className={`flex items-center gap-1 ${metaSize} text-gray-500`}><Package className="h-3 w-3 shrink-0" />{job.poCount} PO{job.poCount === 1 ? '' : 's'}</div>)
        break
      case 'notes':
        if (!show('notes')) break
        break
    }
  }

  return (
    <div
      className={`${borderClass} ${pad} rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow ${onClick ? 'cursor-pointer' : ''} ${gap} flex flex-col`}
      style={borderLeft}
      onClick={onClick}
    >
      {rows}
    </div>
  )
}
