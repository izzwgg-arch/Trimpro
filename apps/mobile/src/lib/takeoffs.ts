// Material takeoff shapes (mirror of the web app's lib/takeoffs; the option lists
// themselves come from the server so Settings changes apply here too).

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

export type TakeoffConfig = {
  doorFields: Record<DoorFieldKey, TakeoffOption[]>
  units: TakeoffOption[]
  categories: Array<{ key: string; label: string; active: boolean; options: TakeoffOption[] }>
}

export type TakeoffResponse = {
  takeoff: {
    id: string
    jobId: string
    title: string
    notes: string
    createdAt: string
    updatedAt: string
    createdBy: { id: string; name: string } | null
    updatedBy: { id: string; name: string } | null
    job: { id: string; jobNumber: string; title: string; customer: string; siteAddress: string } | null
    doors: Array<{ id: string; doorNumber: number; location: string; notes: string } & Record<DoorFieldKey, string>>
    items: Array<{ id: string; category: string; quantity: number | null; unit: string; description: string; notes: string }>
  }
}

export type TakeoffSummary = {
  id: string
  title: string
  updatedAt: string
  createdBy: string
  doorCount: number
  itemCount: number
}

export function activeValues(options: TakeoffOption[] | undefined): string[] {
  return (options || []).filter((o) => o.active).map((o) => o.value)
}
