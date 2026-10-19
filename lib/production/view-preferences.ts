import { prisma } from '@/lib/prisma'

export type ProductionBoardKey = 'jobs' | 'tasks' | 'leads'

export interface BoardViewPref {
  /** Ordered column ids (statuses for tasks/leads, column ids for jobs). */
  order: string[]
  /** Column ids the user has hidden from their own view. */
  hidden: string[]
}

export type ProductionViewPrefs = Partial<Record<ProductionBoardKey, BoardViewPref>>

const KEYS: ProductionBoardKey[] = ['jobs', 'tasks', 'leads']

function normalizeBoard(input: any): BoardViewPref {
  const order = Array.isArray(input?.order) ? input.order.map((x: any) => String(x)).filter(Boolean) : []
  const hidden = Array.isArray(input?.hidden) ? input.hidden.map((x: any) => String(x)).filter(Boolean) : []
  return { order, hidden }
}

export function normalizeViewPrefs(input: any): ProductionViewPrefs {
  const out: ProductionViewPrefs = {}
  if (input && typeof input === 'object') {
    for (const key of KEYS) {
      if (input[key]) out[key] = normalizeBoard(input[key])
    }
  }
  return out
}

export async function getViewPrefs(tenantId: string, userId: string): Promise<ProductionViewPrefs> {
  try {
    const row = await prisma.productionViewPreference.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    })
    return normalizeViewPrefs(row?.prefs ?? null)
  } catch (err) {
    console.error('getViewPrefs failed:', err)
    return {}
  }
}

export async function saveViewPrefs(tenantId: string, userId: string, prefs: ProductionViewPrefs): Promise<ProductionViewPrefs> {
  const normalized = normalizeViewPrefs(prefs)
  await prisma.productionViewPreference.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    create: { tenantId, userId, prefs: normalized as any },
    update: { prefs: normalized as any },
  })
  return normalized
}

/**
 * Apply a user's personal order + hidden columns on top of the full set of
 * columns for a board. Unknown ids are ignored; new columns the user hasn't
 * seen keep their default position (appended after the ordered ones).
 */
export function applyBoardPref<T extends { id: string }>(columns: T[], pref?: BoardViewPref): T[] {
  if (!pref) return columns
  const byId = new Map(columns.map((c) => [c.id, c]))
  const ordered: T[] = []
  for (const id of pref.order) {
    const col = byId.get(id)
    if (col) {
      ordered.push(col)
      byId.delete(id)
    }
  }
  // Append any columns not in the saved order (e.g. newly added).
  for (const col of columns) if (byId.has(col.id)) ordered.push(col)
  const hidden = new Set(pref.hidden)
  return ordered.filter((c) => !hidden.has(c.id))
}
