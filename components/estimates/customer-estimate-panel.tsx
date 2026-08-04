'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  type CustomerLine,
  applyCustomerEdit,
  formatMoney,
} from '@/lib/estimates/company-customer-sync'

export function CustomerEstimatePanel({
  customerLines,
  onChange,
  readOnly = false,
}: {
  customerLines: CustomerLine[]
  onChange?: (next: CustomerLine[]) => void
  readOnly?: boolean
}) {
  const edit = (
    lineId: string,
    patch: Partial<Pick<CustomerLine, 'description' | 'total' | 'title'>>
  ) => {
    if (readOnly || !onChange) return
    onChange(applyCustomerEdit(customerLines, lineId, patch))
  }

  if (customerLines.length === 0) {
    return (
      <p className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
        No customer bundles yet. Add items under a Line # / bundle on the company estimate.
      </p>
    )
  }

  const total = customerLines.reduce((sum, line) => sum + (Number(line.total) || 0), 0)

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        One row per company Line # / bundle. Descriptions are stacked from company item
        descriptions. Edits stick until that company line is changed.
      </p>

      {customerLines.map((line) => (
        <div key={line.id} className="rounded-lg border border-slate-300 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-emerald-50/80 px-3 py-2">
            <span className="rounded bg-emerald-800 px-2 py-0.5 text-xs font-semibold text-white">
              Line #{line.lineNumber}
            </span>
            {readOnly ? (
              <span className="font-semibold">{line.title || '—'}</span>
            ) : (
              <Input
                className="h-8 max-w-xs bg-white"
                value={line.title}
                onChange={(e) => edit(line.id, { title: e.target.value })}
              />
            )}
            {line.customerEdited ? (
              <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                Manual edit — sticky
              </span>
            ) : (
              <span className="rounded border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
                Synced from company
              </span>
            )}
            {readOnly && (
              <span className="ml-auto font-medium">{formatMoney(line.total)}</span>
            )}
          </div>

          {readOnly ? (
            <pre className="whitespace-pre-wrap px-3 py-3 font-mono text-sm">
              {line.description || '—'}
            </pre>
          ) : (
            <div className="grid gap-3 p-3 sm:grid-cols-[1fr_160px]">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Description (each company item on its own row)
                </label>
                <Textarea
                  className="min-h-[110px] font-mono text-sm"
                  value={line.description}
                  onChange={(e) => edit(line.id, { description: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Line total
                </label>
                <Input
                  type="number"
                  step={0.01}
                  value={line.total}
                  onChange={(e) =>
                    edit(line.id, { total: Number(e.target.value) || 0 })
                  }
                />
                <p className="mt-2 text-lg font-semibold">{formatMoney(line.total)}</p>
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex justify-end border-t pt-3 text-base font-semibold">
        Customer estimate total: {formatMoney(total)}
      </div>
    </div>
  )
}
