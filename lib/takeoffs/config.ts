/**
 * Material takeoff dropdowns and categories (company-wide, edited in Settings).
 *
 * Every dropdown also accepts a typed custom value; custom values are saved on the
 * takeoff only and never added here automatically.
 */

export type TakeoffOption = { value: string; active: boolean }

export const DOOR_FIELDS = [
  { key: 'height', label: 'Height' },
  { key: 'width', label: 'Width' },
  { key: 'swing', label: 'Swing' },
  { key: 'lock', label: 'Lock' },
  { key: 'jamb', label: 'Jamb' },
  { key: 'hinge', label: 'Hinge' },
  { key: 'doorStyle', label: 'Door Style' },
] as const

export type DoorFieldKey = (typeof DOOR_FIELDS)[number]['key']

export type TakeoffCategoryConfig = {
  key: string
  label: string
  active: boolean
  /** Suggested descriptions/specs for this category. */
  options: TakeoffOption[]
}

export type TakeoffConfig = {
  doorFields: Record<DoorFieldKey, TakeoffOption[]>
  units: TakeoffOption[]
  categories: TakeoffCategoryConfig[]
}

const opts = (...values: string[]): TakeoffOption[] => values.map((value) => ({ value, active: true }))

// From the company's paper takeoff sheet / Google Sheets dropdowns. Hinge and Door
// Style have no source list yet, so they start empty (typed values, or add in Settings).
export const DEFAULT_DOOR_FIELD_OPTIONS: Record<DoorFieldKey, TakeoffOption[]> = {
  height: opts(`8'0"`, `6'8"`),
  width: opts(`3/0"`, `2/8"`, `2/6"`, `2/4"`, `2/0"`, '50', '28', '60', '38', '34'),
  swing: opts('RH', 'LH', 'Twin', 'Pocket'),
  lock: opts('Entry', 'Privacy', 'Passage', 'Dummy X2', 'Privacy-Dummy'),
  jamb: opts(`5 5/8"`, `6 7/8"`, `6 3/8"`, `4-7/8"`),
  hinge: [],
  doorStyle: [],
}

export const DEFAULT_UNITS: TakeoffOption[] = opts('pcs', 'LF')

export const DEFAULT_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'base', label: 'Base' },
  { key: 'casing', label: 'Casing' },
  { key: 'attic_stair', label: 'Attic Stair' },
  { key: 'windows', label: 'Windows' },
  { key: 'high_windows', label: 'High Windows' },
  { key: 'big_windows', label: 'Big Windows' },
  { key: 'convectors', label: 'Convectors' },
  { key: 'patio_door', label: 'Patio Door' },
  { key: 'trim_entry', label: 'Trim Entry' },
  { key: 'trim_opening', label: 'Trim Opening' },
  { key: 'closets', label: 'Closets' },
]

export function buildDefaultTakeoffConfig(): TakeoffConfig {
  return {
    doorFields: Object.fromEntries(
      DOOR_FIELDS.map((f) => [f.key, DEFAULT_DOOR_FIELD_OPTIONS[f.key].map((o) => ({ ...o }))])
    ) as Record<DoorFieldKey, TakeoffOption[]>,
    units: DEFAULT_UNITS.map((o) => ({ ...o })),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, active: true, options: [] })),
  }
}

const MAX_VALUE = 120

/** Keep the exact text (fractions, quotes, hyphens); only trim outer whitespace. */
export function cleanValue(value: unknown, max = MAX_VALUE): string {
  return String(value ?? '').trim().slice(0, max)
}

function cleanOptions(value: unknown): TakeoffOption[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: TakeoffOption[] = []
  for (const raw of value) {
    const v = cleanValue(typeof raw === 'string' ? raw : (raw as any)?.value)
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push({ value: v, active: typeof raw === 'string' ? true : (raw as any)?.active !== false })
  }
  return out.slice(0, 200)
}

export function slugCategoryKey(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'category'
  )
}

/**
 * Stored config (possibly partial or from an older version) merged over the defaults.
 * A stored list replaces its default list, so removed options stay removed.
 */
export function mergeTakeoffConfig(stored: unknown): TakeoffConfig {
  const base = buildDefaultTakeoffConfig()
  if (!stored || typeof stored !== 'object') return base
  const s = stored as any

  const doorFields = { ...base.doorFields }
  for (const f of DOOR_FIELDS) {
    if (Array.isArray(s.doorFields?.[f.key])) doorFields[f.key] = cleanOptions(s.doorFields[f.key])
  }

  const units = Array.isArray(s.units) ? cleanOptions(s.units) : base.units

  let categories = base.categories
  if (Array.isArray(s.categories)) {
    const seen = new Set<string>()
    categories = []
    for (const c of s.categories) {
      const label = cleanValue(c?.label, 60)
      if (!label) continue
      let key = cleanValue(c?.key, 40) || slugCategoryKey(label)
      while (seen.has(key)) key = `${key}_2`
      seen.add(key)
      categories.push({ key, label, active: c?.active !== false, options: cleanOptions(c?.options) })
    }
    // Categories added to the defaults later still show up (as available).
    for (const d of base.categories) if (!seen.has(d.key)) categories.push(d)
  }

  return { doorFields, units, categories }
}

/** Active values only — what the pickers offer for new entries. */
export function activeValues(options: TakeoffOption[] | undefined): string[] {
  return (options || []).filter((o) => o.active).map((o) => o.value)
}
