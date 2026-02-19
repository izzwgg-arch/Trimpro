'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { formatCurrency } from '@/lib/utils'

type ApprovalItem = {
  id: string
  description: string
  notes: string
  quantity: string
  unitPrice: string
  total: string
  approved: boolean
  approvedAt: string | null
  approvedByName: string | null
  invoiced: boolean
  invoicedAt: string | null
}

export default function PublicEstimateApprovalPage() {
  const params = useParams()
  const token = String((params as any)?.token || '')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<any>(null)
  const [items, setItems] = useState<ApprovalItem[]>([])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [signerName, setSignerName] = useState('')
  const [eSign, setESign] = useState(false)
  const [busy, setBusy] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [createdInvoice, setCreatedInvoice] = useState<{ invoiceNumber: string; portalPayUrl?: string } | null>(null)

  const selectableIds = useMemo(() => {
    return items.filter((i) => !i.approved).map((i) => i.id)
  }, [items])

  const selectedTotal = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i]))
    let sum = 0
    for (const id of selectedIds) {
      const it = map.get(id)
      if (!it) continue
      sum += Number(it.total || 0)
    }
    return sum
  }, [items, selectedIds])

  const refresh = async () => {
    setLoading(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const res = await fetch(`/api/public/estimate-approval/${encodeURIComponent(token)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Unable to load estimate approval.')
        setEstimate(null)
        setItems([])
        return
      }

      setEstimate(data.estimate)
      setItems(data.items || [])

      // Remove any selections that are no longer selectable.
      setSelectedIds((prev) => {
        const next = new Set<string>()
        const allowed = new Set((data.items || []).filter((i: any) => !i.approved).map((i: any) => i.id))
        for (const id of prev) {
          if (allowed.has(id)) next.add(id)
        }
        return next
      })
    } catch (e: any) {
      setError(e?.message || 'Unable to load estimate approval.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(selectableIds))
  }

  const clearAll = () => {
    setSelectedIds(new Set())
  }

  const approve = async (approveAll: boolean) => {
    setBusy(true)
    setSuccessMsg(null)
    setCreatedInvoice(null)
    try {
      if (!signerName.trim()) {
        setError('Signer name is required.')
        return
      }
      if (!eSign) {
        setError('Please confirm you approve this estimate.')
        return
      }
      if (!approveAll && selectedIds.size === 0) {
        setError('Select at least one item to approve.')
        return
      }

      setError(null)
      const res = await fetch(`/api/public/estimate-approval/${encodeURIComponent(token)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approveAll,
          selectedLineItemIds: approveAll ? undefined : Array.from(selectedIds),
          signerName: signerName.trim(),
          eSign: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Approval failed.')
        return
      }

      setSuccessMsg(`Approved ${data.approvedCount || 0} item(s).`)
      await refresh()
      clearAll()
    } finally {
      setBusy(false)
    }
  }

  const createInvoice = async () => {
    setBusy(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await fetch(`/api/public/estimate-approval/${encodeURIComponent(token)}/create-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Unable to create invoice.')
        return
      }

      setCreatedInvoice({
        invoiceNumber: data?.invoice?.invoiceNumber || 'Invoice',
        portalPayUrl: data?.invoice?.portalPayUrl,
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-600">Loading...</div>
  }

  if (error) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Estimate Approval</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-red-600">{error}</div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>
            Approve Estimate {estimate?.estimateNumber ? `• ${estimate.estimateNumber}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-700">
          <div>{estimate?.title || ''}</div>
          {estimate?.client?.name && <div>Client: {estimate.client.name}</div>}
          {estimate?.jobSiteAddress && <div>Address: {estimate.jobSiteAddress}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={selectAll} disabled={busy || selectableIds.length === 0}>
              Select All
            </Button>
            <Button type="button" variant="outline" onClick={clearAll} disabled={busy || selectedIds.size === 0}>
              Clear
            </Button>
            <div className="ml-auto text-sm text-gray-600">
              Selected total: {formatCurrency(selectedTotal)}
            </div>
          </div>

          <div className="overflow-x-auto border rounded-md">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  <th className="p-3 w-10"> </th>
                  <th className="p-3">Item</th>
                  <th className="p-3">Description</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-right">Unit</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const canSelect = !it.approved
                  const checked = it.approved || selectedIds.has(it.id)
                  return (
                    <tr key={it.id} className="border-t">
                      <td className="p-3">
                        <Checkbox
                          checked={checked}
                          disabled={!canSelect || busy}
                          onCheckedChange={() => toggle(it.id)}
                        />
                      </td>
                      <td className="p-3 font-medium">{it.description}</td>
                      <td className="p-3 text-gray-600">{it.notes || '-'}</td>
                      <td className="p-3 text-right">{Number(it.quantity || 0).toFixed(2)}</td>
                      <td className="p-3 text-right">{formatCurrency(Number(it.unitPrice || 0))}</td>
                      <td className="p-3 text-right font-semibold">{formatCurrency(Number(it.total || 0))}</td>
                      <td className="p-3">
                        {it.invoiced ? (
                          <span className="text-xs rounded bg-green-50 border border-green-200 px-2 py-1 text-green-800">
                            Already invoiced
                          </span>
                        ) : it.approved ? (
                          <span className="text-xs rounded bg-blue-50 border border-blue-200 px-2 py-1 text-blue-800">
                            Approved
                          </span>
                        ) : (
                          <span className="text-xs rounded bg-gray-50 border border-gray-200 px-2 py-1 text-gray-700">
                            Not approved
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Signer Name</label>
              <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="flex items-end gap-2">
              <Checkbox checked={eSign} onCheckedChange={(v) => setESign(Boolean(v))} />
              <span className="text-sm">I approve this estimate</span>
            </div>
          </div>

          {successMsg && <div className="text-green-700 text-sm">{successMsg}</div>}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => approve(true)} disabled={busy || selectableIds.length === 0}>
              Approve All
            </Button>
            <Button type="button" variant="outline" onClick={() => approve(false)} disabled={busy || selectedIds.size === 0}>
              Approve Selected Items
            </Button>
            <Button type="button" variant="secondary" onClick={createInvoice} disabled={busy}>
              Create Invoice
            </Button>
          </div>

          {createdInvoice && (
            <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
              Invoice created: <strong>{createdInvoice.invoiceNumber}</strong>
              {createdInvoice.portalPayUrl && (
                <div className="mt-1">
                  <a className="underline" href={createdInvoice.portalPayUrl}>
                    Pay / View Invoice
                  </a>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

