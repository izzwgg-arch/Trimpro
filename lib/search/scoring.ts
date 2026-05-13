/**
 * Pure scoring helpers for global search — no Prisma, safe to import in tests.
 */

export interface RawResult {
  id: string
  entityType: string
  title: string
  subtitle: string
  url: string
  score: number
  updatedAt?: Date | null
}

/**
 * Score how well `value` matches `query`.
 * Returns 0–1:  1.0 = exact  0.85 = prefix  0.7 = contains  0 = no match
 */
export function matchScore(query: string, value: string | null | undefined): number {
  if (!value) return 0
  const lv = value.toLowerCase()
  const lq = query.toLowerCase()
  if (lv === lq) return 1.0
  if (lv.startsWith(lq)) return 0.85
  if (lv.includes(lq)) return 0.7
  return 0
}

/**
 * Compute a composite relevance score for a result row.
 * Primary fields (names, numbers) are weighted 100; secondary (notes, desc) 40.
 * Recent records get a small bonus.
 */
export function computeScore(
  query: string,
  primaryFields: (string | null | undefined)[],
  secondaryFields: (string | null | undefined)[],
  updatedAt?: Date | null
): number {
  let primary = 0
  for (const v of primaryFields) {
    primary = Math.max(primary, matchScore(query, v) * 100)
  }

  let secondary = 0
  for (const v of secondaryFields) {
    secondary = Math.max(secondary, matchScore(query, v) * 40)
  }

  let recency = 0
  if (updatedAt) {
    const days = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000
    if (days < 7) recency = 15
    else if (days < 30) recency = 10
    else if (days < 90) recency = 5
  }

  return Math.round(primary + secondary + recency)
}

/** Sort results by score desc and take the top N. */
export function topN<T extends { score: number }>(items: T[], n: number): T[] {
  return [...items].sort((a, b) => b.score - a.score).slice(0, n)
}

/**
 * Expand the user's raw query into additional search terms via a synonym map.
 * Returns all distinct terms to use (including the original).
 *
 * For the DB queries we still use one primary query; this function is used
 * to tell the scoring layer that a synonym term also counts as a match.
 */
const SYNONYM_MAP: Record<string, string[]> = {
  customer: ['client'],
  client: ['customer'],
  vendor: ['supplier'],
  supplier: ['vendor'],
  estimate: ['proposal', 'quote'],
  proposal: ['estimate', 'quote'],
  quote: ['estimate', 'proposal'],
  po: ['purchase order', 'purchaseorder'],
  'purchase order': ['po'],
  purchaseorder: ['po'],
  file: ['attachment', 'document', 'pdf'],
  attachment: ['file', 'document'],
  document: ['file', 'attachment', 'pdf'],
  pdf: ['file', 'document', 'attachment'],
  paid: ['payment', 'completed'],
  payment: ['paid'],
  partial: ['deposit', 'partial payment'],
  deposit: ['partial', 'partial payment'],
  job: ['project', 'work order'],
  project: ['job'],
  task: ['reminder', 'to-do'],
  reminder: ['task'],
  note: ['comment'],
  comment: ['note'],
}

export function expandQuery(raw: string): string[] {
  const q = raw.trim().toLowerCase()
  const synonyms = SYNONYM_MAP[q] ?? []
  return Array.from(new Set([q, ...synonyms]))
}
