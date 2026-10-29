'use client'

import { AlertTriangle, Briefcase, Calendar, CheckSquare, FileText, Inbox, MapPin, PauseCircle, Receipt, User } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { PipelineItem } from '@/lib/production/pipeline-data'

export const RECORD_TYPE_META: Record<PipelineItem['type'], { label: string; className: string; Icon: typeof Briefcase }> = {
  JOB: { label: 'Job', className: 'bg-slate-100 text-slate-700 border-slate-200', Icon: Briefcase },
  ESTIMATE: { label: 'Estimate', className: 'bg-violet-50 text-violet-700 border-violet-200', Icon: FileText },
  INVOICE: { label: 'Invoice', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: Receipt },
  TASK: { label: 'Task', className: 'bg-blue-50 text-blue-700 border-blue-200', Icon: CheckSquare },
  REQUEST: { label: 'Request', className: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200', Icon: Inbox },
}

export function RecordTypeBadge({ type }: { type: PipelineItem['type'] }) {
  const meta = RECORD_TYPE_META[type]
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.className}`}>
      <meta.Icon className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

export function shortDate(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function daysLabel(days: number | null): string | null {
  if (days === null) return null
  if (days === 0) return 'today'
  return days === 1 ? '1 day' : `${days} days`
}

/** Status words as the record itself uses them (e.g. "Viewed", "Partial"). */
export function statusWord(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Card for the Estimates / Invoices pipeline boards. Matches the jobs board card's look. */
export function PipelineCard({
  item,
  onOpen,
  onManage,
  onOpenRelated,
}: {
  item: PipelineItem
  onOpen: () => void
  onManage?: () => void
  onOpenRelated: (href: string) => void
}) {
  const isInvoice = item.type === 'INVOICE'
  const overdueDue = isInvoice && item.stage === 'OVERDUE'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      className="cursor-pointer rounded-lg border border-l-4 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
      style={{ borderLeftColor: item.stageColor }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-blue-700">{item.number}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600" title="The record's own status">
          {statusWord(item.status)}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 text-sm font-semibold text-gray-900">{item.title}</div>
      {item.client ? <div className="line-clamp-1 text-xs text-gray-600">{item.client.name}</div> : null}

      {item.hold.onHold ? (
        <div className="mt-2 flex items-start gap-1 rounded bg-orange-50 px-2 py-1 text-[11px] text-orange-800">
          <PauseCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">On hold{item.hold.reason ? `: ${item.hold.reason}` : ''}</span>
        </div>
      ) : null}
      {item.disputed && item.stage === 'DISPUTED' ? (
        <div className="mt-2 rounded bg-fuchsia-50 px-2 py-1 text-[11px] font-medium text-fuchsia-800">Disputed</div>
      ) : null}

      <div className="mt-2 space-y-0.5 text-[11px] text-gray-600">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-gray-900">{formatCurrency(item.amount)}</span>
          {isInvoice && item.balance !== null && item.balance > 0 && item.balance < item.amount ? (
            <span>Paid {formatCurrency(item.paidAmount || 0)}</span>
          ) : null}
        </div>
        {isInvoice && item.balance !== null && item.balance > 0 ? (
          <div className={overdueDue ? 'font-semibold text-red-600' : ''}>Balance {formatCurrency(item.balance)}</div>
        ) : null}
        {item.jobSiteAddress ? (
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0 text-gray-400" />
            <span className="line-clamp-1">{item.jobSiteAddress}</span>
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <User className="h-3 w-3 shrink-0 text-gray-400" />
          <span className="line-clamp-1">{item.responsible ? item.responsible.name : 'Unassigned'}</span>
        </div>
        {isInvoice && item.date ? (
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3 shrink-0 text-gray-400" />
            Invoice date {shortDate(item.date)}
          </div>
        ) : null}
        {isInvoice && item.dueDate ? (
          <div className={`flex items-center gap-1 ${overdueDue ? 'text-red-600' : ''}`}>
            <Calendar className="h-3 w-3 shrink-0" />
            Due {shortDate(item.dueDate)}
          </div>
        ) : null}
        {item.nextAction ? (
          <div>
            <span className="font-medium text-gray-700">Next:</span> {item.nextAction}
          </div>
        ) : null}
        {item.followUpDate ? (
          <div className={`flex items-center gap-1 ${item.followUpOverdue ? 'font-semibold text-red-600' : ''}`}>
            {item.followUpOverdue ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Calendar className="h-3 w-3 shrink-0" />}
            Follow up {shortDate(item.followUpDate)}
          </div>
        ) : null}
        {item.daysInStage !== null ? (
          <div className="text-gray-400">
            In stage {daysLabel(item.daysInStage)}
            {item.enteredAt ? ` · since ${shortDate(item.enteredAt)}` : ''}
          </div>
        ) : null}
      </div>

      {(item.related.job || item.related.estimate || item.related.invoices.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
          {item.related.estimate ? (
            <RelatedChip label={item.related.estimate.estimateNumber} onClick={() => onOpenRelated(`/dashboard/estimates/${item.related.estimate!.id}`)} />
          ) : null}
          {item.related.job ? (
            <RelatedChip label={item.related.job.jobNumber} onClick={() => onOpenRelated(`/dashboard/jobs/${item.related.job!.id}`)} />
          ) : null}
          {item.related.invoices.slice(0, 3).map((i) => (
            <RelatedChip key={i.id} label={i.invoiceNumber} onClick={() => onOpenRelated(`/dashboard/invoices/${i.id}`)} />
          ))}
          {item.related.invoices.length > 3 ? <span className="text-[10px] text-gray-400">+{item.related.invoices.length - 3}</span> : null}
        </div>
      )}

      {onManage ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onManage()
          }}
          className="mt-2 w-full rounded border border-gray-200 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
        >
          Hold & next action
        </button>
      ) : null}
    </div>
  )
}

export function RelatedChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
    >
      {label}
    </button>
  )
}
