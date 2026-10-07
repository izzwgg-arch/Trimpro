/**
 * Summarize line-item changes between a document's previous and incoming
 * line items for audit history. Matching is by (trimmed, lower-cased)
 * description; quantity/price/total differences count as a change.
 */

export interface LineItemLike {
  description?: string | null
  quantity?: number | string | null
  unitPrice?: number | string | null
  total?: number | string | null
}

export interface LineItemChangeSummary {
  added: string[]
  removed: string[]
  changed: string[]
  /** One-line, human-readable summary, or null when nothing changed. */
  summary: string | null
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function keyOf(item: LineItemLike): string {
  return String(item?.description || '').trim().toLowerCase()
}

function label(item: LineItemLike): string {
  return String(item?.description || '').trim() || '(no description)'
}

export function summarizeLineItemChanges(
  before: LineItemLike[] | null | undefined,
  after: LineItemLike[] | null | undefined
): LineItemChangeSummary {
  const empty: LineItemChangeSummary = { added: [], removed: [], changed: [], summary: null }
  if (!Array.isArray(after)) return empty // caller didn't send line items → unchanged

  const beforeList = Array.isArray(before) ? before : []
  const beforeByKey = new Map<string, LineItemLike>()
  for (const b of beforeList) beforeByKey.set(keyOf(b), b)
  const afterByKey = new Map<string, LineItemLike>()
  for (const a of after) afterByKey.set(keyOf(a), a)

  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []

  for (const a of after) {
    const k = keyOf(a)
    const b = beforeByKey.get(k)
    if (!b) {
      added.push(label(a))
    } else if (
      num(a.quantity) !== num(b.quantity) ||
      num(a.unitPrice) !== num(b.unitPrice) ||
      num(a.total) !== num(b.total)
    ) {
      changed.push(label(a))
    }
  }
  for (const b of beforeList) {
    if (!afterByKey.has(keyOf(b))) removed.push(label(b))
  }

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    return { added, removed, changed, summary: null }
  }

  const parts: string[] = []
  if (added.length) parts.push(`${added.length} added`)
  if (removed.length) parts.push(`${removed.length} removed`)
  if (changed.length) parts.push(`${changed.length} changed`)
  return { added, removed, changed, summary: parts.join(', ') }
}
