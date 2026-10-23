'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { authFetch } from '@/lib/auth/client'
import { formatDateTime } from '@/lib/utils'
import { DOOR_FIELDS, type TakeoffConfig } from '@/lib/takeoffs/config'
import { isDoorFilled } from '@/lib/takeoffs/model'

/** Paper version of a material takeoff (no menus or buttons when printed). */
export default function PrintTakeoffPage() {
  const params = useParams<{ id: string }>()
  const [takeoff, setTakeoff] = useState<any>(null)
  const [config, setConfig] = useState<TakeoffConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hideEmpty, setHideEmpty] = useState(true)

  useEffect(() => {
    ;(async () => {
      const [tRes, cRes] = await Promise.all([authFetch(`/api/takeoffs/${params.id}`), authFetch('/api/takeoffs/settings')])
      const t = await tRes.json().catch(() => ({}))
      const c = await cRes.json().catch(() => ({}))
      if (!tRes.ok) {
        setError(t.error || 'Could not load this takeoff')
        return
      }
      setTakeoff(t.takeoff)
      if (cRes.ok) setConfig(c.config)
    })()
  }, [params.id])

  if (error) return <p className="p-8 text-red-600">{error}</p>
  if (!takeoff) return <p className="p-8 text-gray-600">Loading…</p>

  const doors = (takeoff.doors as any[]).filter((d) => !hideEmpty || isDoorFilled(d))
  const labelOf = (key: string) => config?.categories.find((c) => c.key === key)?.label || key
  const categoryOrder = [
    ...(config?.categories || []).map((c) => c.key),
    ...Array.from(new Set((takeoff.items as any[]).map((i) => i.category))),
  ].filter((k, i, all) => all.indexOf(k) === i)
  const groups = categoryOrder
    .map((key) => ({ key, rows: (takeoff.items as any[]).filter((i) => i.category === key) }))
    .filter((g) => g.rows.length > 0)

  return (
    <div className="mx-auto max-w-[1100px] bg-white p-6 text-[12px] text-black print:p-0">
      <style>{`@media print { @page { size: landscape; margin: 12mm; } }`}</style>

      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Leave out empty door rows
        </label>
        <button type="button" onClick={() => window.print()} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white">
          Print / Save as PDF
        </button>
      </div>

      <h1 className="text-xl font-bold">Material Takeoff{takeoff.title ? ` — ${takeoff.title}` : ''}</h1>
      <table className="mt-2 w-full">
        <tbody>
          <tr>
            <td className="w-1/3 py-0.5"><b>Customer:</b> {takeoff.job?.customer || '—'}</td>
            <td className="w-1/3 py-0.5"><b>Job:</b> {takeoff.job ? `${takeoff.job.jobNumber} — ${takeoff.job.title}` : '—'}</td>
            <td className="w-1/3 py-0.5"><b>Job Site:</b> {takeoff.job?.siteAddress || '—'}</td>
          </tr>
          <tr>
            <td className="py-0.5">
              <b>Created:</b> {formatDateTime(takeoff.createdAt)}
              {takeoff.createdBy?.name ? ` by ${takeoff.createdBy.name}` : ''}
            </td>
            <td className="py-0.5" colSpan={2}>
              <b>Last updated:</b> {formatDateTime(takeoff.updatedAt)}
              {takeoff.updatedBy?.name ? ` by ${takeoff.updatedBy.name}` : ''}
            </td>
          </tr>
        </tbody>
      </table>
      {takeoff.notes ? (
        <p className="mt-2 whitespace-pre-wrap">
          <b>Notes:</b> {takeoff.notes}
        </p>
      ) : null}

      <h2 className="mt-5 text-base font-bold">Door Schedule</h2>
      {doors.length === 0 ? (
        <p className="text-gray-500">No doors.</p>
      ) : (
        <table className="mt-1 w-full border-collapse">
          <thead>
            <tr>
              <th className="border border-gray-400 px-1 py-1 text-left">#</th>
              <th className="border border-gray-400 px-1 py-1 text-left">Location / Notes</th>
              {DOOR_FIELDS.map((f) => (
                <th key={f.key} className="border border-gray-400 px-1 py-1 text-left">
                  {f.label}
                </th>
              ))}
              <th className="border border-gray-400 px-1 py-1 text-left">Additional Notes</th>
            </tr>
          </thead>
          <tbody>
            {doors.map((d: any) => (
              <tr key={d.id} className="break-inside-avoid">
                <td className="border border-gray-400 px-1 py-1 font-semibold">{d.doorNumber}</td>
                <td className="border border-gray-400 px-1 py-1">{d.location}</td>
                {DOOR_FIELDS.map((f) => (
                  <td key={f.key} className="border border-gray-400 px-1 py-1">
                    {d[f.key]}
                  </td>
                ))}
                <td className="border border-gray-400 px-1 py-1">{d.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-5 text-base font-bold">Other Materials</h2>
      {groups.length === 0 ? (
        <p className="text-gray-500">No other materials.</p>
      ) : (
        <table className="mt-1 w-full border-collapse">
          <thead>
            <tr>
              <th className="border border-gray-400 px-1 py-1 text-left">Category</th>
              <th className="border border-gray-400 px-1 py-1 text-right">Qty</th>
              <th className="border border-gray-400 px-1 py-1 text-left">Unit</th>
              <th className="border border-gray-400 px-1 py-1 text-left">Description / Spec</th>
              <th className="border border-gray-400 px-1 py-1 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((g) =>
              g.rows.map((it: any, i: number) => (
                <tr key={it.id} className="break-inside-avoid">
                  <td className="border border-gray-400 px-1 py-1 font-semibold">{i === 0 ? labelOf(g.key) : ''}</td>
                  <td className="border border-gray-400 px-1 py-1 text-right">{it.quantity ?? ''}</td>
                  <td className="border border-gray-400 px-1 py-1">{it.unit}</td>
                  <td className="border border-gray-400 px-1 py-1">{it.description}</td>
                  <td className="border border-gray-400 px-1 py-1">{it.notes}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
