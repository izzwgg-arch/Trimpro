export type InvoiceAllocationRow = {
  id: string
  balance: unknown
  dueDate?: Date | string | null
  invoiceDate?: Date | string | null
}

export function parsePublicPaymentAmount(value: unknown): number | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const normalized = raw.replace(/[^0-9.]/g, '')
  if (!normalized) return null
  const n = Number(normalized)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function dateMs(value: Date | string | null | undefined): number {
  if (!value) return 0
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** Dominant (current) invoice first, then remaining by due date / invoice date ascending. */
export function orderInvoicesDominantFirst<T extends InvoiceAllocationRow>(
  dominantInvoiceId: string,
  invoices: T[]
): T[] {
  const dominant = invoices.find((inv) => String(inv.id) === String(dominantInvoiceId))
  const rest = invoices.filter((inv) => String(inv.id) !== String(dominantInvoiceId))
  rest.sort((a, b) => {
    const dueDiff = dateMs(a.dueDate) - dateMs(b.dueDate)
    if (dueDiff !== 0) return dueDiff
    return dateMs(a.invoiceDate) - dateMs(b.invoiceDate)
  })
  return dominant ? [dominant, ...rest] : rest
}

/** Re-sort fetched invoice rows to match the order stored on the payment intent. */
export function orderInvoicesByStoredIds<T extends { id: string }>(invoiceIds: string[], invoices: T[]): T[] {
  const order = new Map(invoiceIds.map((id, index) => [String(id), index]))
  return [...invoices].sort(
    (a, b) => (order.get(String(a.id)) ?? 9999) - (order.get(String(b.id)) ?? 9999)
  )
}

export function buildWaterfallPlannedAmounts<T extends InvoiceAllocationRow>(
  invoices: T[],
  maxTotalAmount: number
): Record<string, number> {
  let remaining = Math.max(0, maxTotalAmount)
  const planned: Record<string, number> = {}
  for (const inv of invoices) {
    if (remaining <= 0) break
    const balance = Math.max(0, Number(inv.balance || 0))
    if (balance <= 0) continue
    const apply = Math.min(balance, remaining)
    planned[String(inv.id)] = apply
    remaining -= apply
  }
  return planned
}
