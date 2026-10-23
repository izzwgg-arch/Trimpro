/**
 * Material takeoff payloads: validation of what a client sends, and turning a
 * takeoff into purchase order lines. Pure functions (no database) so they are
 * easy to test.
 */
import { cleanValue, DOOR_FIELDS, type DoorFieldKey, type TakeoffConfig } from './config'

export const MAX_DOORS = 500
export const MAX_ITEMS = 1000
const MAX_NOTES = 4000

export type TakeoffDoorInput = {
  location: string
  notes: string
} & Record<DoorFieldKey, string>

export type TakeoffItemInput = {
  category: string
  quantity: number | null
  unit: string
  description: string
  notes: string
}

export type TakeoffInput = {
  title: string
  notes: string
  doors: TakeoffDoorInput[]
  items: TakeoffItemInput[]
}

/** "12", "12.5", "1 1/2", "3/4" → number; anything else → null. */
export function parseQuantity(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null
  const text = String(value).trim()
  if (!text) return null
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) {
    const d = Number(mixed[3])
    return d ? Math.round((Number(mixed[1]) + Number(mixed[2]) / d) * 100) / 100 : null
  }
  const frac = text.match(/^(\d+)\/(\d+)$/)
  if (frac) {
    const d = Number(frac[2])
    return d ? Math.round((Number(frac[1]) / d) * 100) / 100 : null
  }
  const n = Number(text.replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n * 100) / 100 : null
}

export type ParseResult = { ok: true; value: TakeoffInput } | { ok: false; error: string }

export function parseTakeoffInput(body: any, categories: Array<{ key: string; label: string }>): ParseResult {
  const doorsRaw = Array.isArray(body?.doors) ? body.doors : []
  const itemsRaw = Array.isArray(body?.items) ? body.items : []
  if (doorsRaw.length > MAX_DOORS) return { ok: false, error: `A takeoff can have at most ${MAX_DOORS} doors` }
  if (itemsRaw.length > MAX_ITEMS) return { ok: false, error: `A takeoff can have at most ${MAX_ITEMS} materials` }

  const doors: TakeoffDoorInput[] = doorsRaw.map((d: any) => {
    const row: any = { location: cleanValue(d?.location, 300), notes: cleanValue(d?.notes, MAX_NOTES) }
    for (const f of DOOR_FIELDS) row[f.key] = cleanValue(d?.[f.key])
    return row as TakeoffDoorInput
  })

  const labels = new Map(categories.map((c) => [c.key, c.label]))
  const items: TakeoffItemInput[] = []
  for (const it of itemsRaw) {
    const category = cleanValue(it?.category, 40)
    // Rows for a category that no longer exists in Settings are kept as they were.
    if (!category) return { ok: false, error: 'Every material needs a category' }
    const rawQty = it?.quantity
    const quantity = parseQuantity(rawQty)
    if (rawQty !== null && rawQty !== undefined && String(rawQty).trim() !== '' && quantity === null) {
      const label = labels.get(category) || category
      return { ok: false, error: `Quantity "${String(rawQty)}" for ${label} is not a number` }
    }
    items.push({
      category,
      quantity,
      unit: cleanValue(it?.unit, 40),
      description: cleanValue(it?.description, 500),
      notes: cleanValue(it?.notes, MAX_NOTES),
    })
  }

  return {
    ok: true,
    value: {
      title: cleanValue(body?.title, 120),
      notes: cleanValue(body?.notes, MAX_NOTES),
      doors,
      items,
    },
  }
}

/** A door row counts as filled in when any field has a value. */
export function isDoorFilled(d: Partial<TakeoffDoorInput>): boolean {
  return Boolean(d.location || d.notes || DOOR_FIELDS.some((f) => (d as any)[f.key]))
}

export type PoLine = {
  description: string
  details: string
  quantity: string
  notes: string
}

/**
 * Purchase order lines for a takeoff: identical doors are grouped into one line
 * (with their door numbers), each lock type becomes one line, and every material
 * entry becomes its own line. Prices are left for the buyer to fill in.
 */
export function buildPurchaseOrderLines(
  takeoff: {
    doors: Array<Partial<TakeoffDoorInput> & { doorNumber: number }>
    items: Array<{ category: string; quantity: number | string | null; unit: string | null; description: string | null; notes: string | null }>
  },
  config: Pick<TakeoffConfig, 'categories'>
): PoLine[] {
  const lines: PoLine[] = []

  const doorGroups = new Map<string, { door: Partial<TakeoffDoorInput>; numbers: number[] }>()
  const lockGroups = new Map<string, number[]>()
  for (const d of takeoff.doors) {
    if (!isDoorFilled(d)) continue
    const key = [d.width, d.height, d.swing, d.jamb, d.hinge, d.doorStyle].map((v) => v || '').join('|')
    const g = doorGroups.get(key) || { door: d, numbers: [] }
    g.numbers.push(d.doorNumber)
    doorGroups.set(key, g)
    if (d.lock) lockGroups.set(d.lock, [...(lockGroups.get(d.lock) || []), d.doorNumber])
  }
  for (const { door, numbers } of Array.from(doorGroups.values())) {
    const size = [door.width, door.height].filter(Boolean).join(' x ')
    const description = ['Door', size, door.doorStyle].filter(Boolean).join(' ')
    const details = [
      door.swing ? `Swing: ${door.swing}` : '',
      door.jamb ? `Jamb: ${door.jamb}` : '',
      door.hinge ? `Hinge: ${door.hinge}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    lines.push({
      description,
      details,
      quantity: String(numbers.length),
      notes: `Door #${numbers.join(', #')}`,
    })
  }
  for (const [lock, numbers] of Array.from(lockGroups.entries())) {
    lines.push({ description: `Lock: ${lock}`, details: '', quantity: String(numbers.length), notes: `Door #${numbers.join(', #')}` })
  }

  const labelFor = (key: string) => config.categories.find((c) => c.key === key)?.label || key
  for (const it of takeoff.items) {
    const qty = it.quantity === null || it.quantity === undefined || it.quantity === '' ? null : Number(it.quantity)
    if (!it.description && (qty === null || qty === 0) && !it.notes) continue
    lines.push({
      description: it.description ? `${labelFor(it.category)}: ${it.description}` : labelFor(it.category),
      details: it.unit ? `Unit: ${it.unit}` : '',
      quantity: qty === null ? '1' : String(qty),
      notes: it.notes || '',
    })
  }
  return lines
}
