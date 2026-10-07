'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Building2, CheckCircle2, ExternalLink, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ResponsivePage } from '@/components/layout/ResponsivePage'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type CustomerLine,
  buildCustomerDescription,
  formatMoney,
  lineItemTotal,
} from '@/lib/estimates/company-customer-sync'

type SavedEstimate = {
  id: string
  estimateNumber: string
  title: string
  status: string
  subtotal: string
  taxAmount: string
  discount: string
  total: string
  client?: { id: string; name: string; companyName?: string | null } | null
  lineItems: Array<{
    id: string
    description: string
    notes?: string | null
    quantity: string
    unitPrice: string
    unitCost?: string | null
    taxable?: boolean
    taxRate?: string | null
    total: string
    groupId?: string | null
    group?: { id: string; name: string } | null
  }>
}

type CompanyGroupView = {
  id: string
  name: string
  items: SavedEstimate['lineItems']
  total: number
}

export default function DualEstimateSavedPage() {
  const params = useParams()
  const estimateId = String(params.id || '')
  const [estimate, setEstimate] = useState<SavedEstimate | null>(null)
  const [customerLines, setCustomerLines] = useState<CustomerLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!estimateId) return
    const token = localStorage.getItem('accessToken')
    if (!token) {
      setError('Not signed in')
      setLoading(false)
      return
    }

    try {
      const raw = sessionStorage.getItem(`dual-estimate-customer:${estimateId}`)
      if (raw) setCustomerLines(JSON.parse(raw) as CustomerLine[])
    } catch {
      // ignore
    }

    fetch(`/api/estimates/${estimateId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load saved estimate')
        const data = await res.json()
        setEstimate(data.estimate)
      })
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [estimateId])

  const groups = useMemo<CompanyGroupView[]>(() => {
    if (!estimate) return []
    const map = new Map<string, CompanyGroupView>()
    const ungrouped: CompanyGroupView = {
      id: 'ungrouped',
      name: 'Ungrouped',
      items: [],
      total: 0,
    }

    for (const item of estimate.lineItems || []) {
      const groupId = item.groupId || item.group?.id
      if (!groupId) {
        ungrouped.items.push(item)
        ungrouped.total += parseFloat(item.total || '0') || 0
        continue
      }
      if (!map.has(groupId)) {
        map.set(groupId, {
          id: groupId,
          name: item.group?.name || 'Line',
          items: [],
          total: 0,
        })
      }
      const group = map.get(groupId)!
      group.items.push(item)
      group.total += parseFloat(item.total || '0') || 0
    }

    const list = Array.from(map.values())
    if (ungrouped.items.length) list.push(ungrouped)
    return list
  }, [estimate])

  const derivedCustomer = useMemo(() => {
    if (customerLines.length) return customerLines
    return groups
      .filter((g) => g.id !== 'ungrouped')
      .map((group, index) => ({
        id: group.id,
        lineNumber: index + 1,
        title: group.name.replace(/^Line #\d+\s*—\s*/, ''),
        description: buildCustomerDescription(
          group.items.map((item) => ({
            id: item.id,
            description: item.description,
            notes: item.notes || '',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitCost: item.unitCost || '',
            taxable: item.taxable !== false,
            taxRate: item.taxRate || '',
            isVisibleToClient: true,
            showDescriptionToCustomer: true,
            showCostToCustomer: false,
            showPriceToCustomer: true,
            showTaxToCustomer: true,
            showNotesToCustomer: true,
          }))
        ),
        total: Math.round(group.total * 100) / 100,
        customerEdited: false,
      }))
  }, [customerLines, groups])

  if (loading) {
    return (
      <ResponsivePage>
        <p className="text-sm text-muted-foreground">Loading saved estimate…</p>
      </ResponsivePage>
    )
  }

  if (error || !estimate) {
    return (
      <ResponsivePage>
        <p className="text-sm text-red-600">{error || 'Estimate not found'}</p>
        <Link href="/dashboard/estimates/company-customer-demo">
          <Button variant="outline" className="mt-3">
            Back to demo
          </Button>
        </Link>
      </ResponsivePage>
    )
  }

  return (
    <ResponsivePage>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Estimate saved</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {estimate.estimateNumber} — {estimate.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Status: {estimate.status}
            {estimate.client ? ` · ${estimate.client.companyName || estimate.client.name}` : ''}
            {' · '}Total {formatMoney(parseFloat(estimate.total || '0'))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/estimates/company-customer-demo">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to demo
            </Button>
          </Link>
          <Link href={`/dashboard/estimates/${estimate.id}`}>
            <Button>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open estimate
            </Button>
          </Link>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
        After save: company line items are stored on the estimate (with Line # groups) and are what
        QuickBooks sync uses. Customer bundles below are the dual-view summary of those groups.
      </div>

      <Tabs defaultValue="company">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="company" className="gap-1.5">
            <Building2 className="h-4 w-4" />
            Company (saved)
          </TabsTrigger>
          <TabsTrigger value="customer" className="gap-1.5">
            <User className="h-4 w-4" />
            Customer (saved)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-4 space-y-4">
          {groups.map((group) => (
            <div key={group.id} className="rounded-lg border bg-white">
              <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2">
                <span className="font-semibold">{group.name}</span>
                <span className="font-medium">{formatMoney(group.total)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2">Qty</th>
                      <th className="px-3 py-2">Price</th>
                      <th className="px-3 py-2">Cost</th>
                      <th className="px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.id} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{item.description}</td>
                        <td className="px-3 py-2 text-muted-foreground">{item.notes || '—'}</td>
                        <td className="px-3 py-2">{item.quantity}</td>
                        <td className="px-3 py-2">
                          {formatMoney(parseFloat(item.unitPrice || '0'))}
                        </td>
                        <td className="px-3 py-2">
                          {item.unitCost != null && item.unitCost !== ''
                            ? formatMoney(parseFloat(String(item.unitCost)))
                            : '—'}
                        </td>
                        <td className="px-3 py-2 font-medium">
                          {formatMoney(
                            parseFloat(item.total || '0') ||
                              lineItemTotal({
                                quantity: item.quantity,
                                unitPrice: item.unitPrice,
                              })
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="customer" className="mt-4 space-y-4">
          {derivedCustomer.map((line) => (
            <div key={line.id} className="rounded-lg border bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b bg-emerald-50/80 px-3 py-2">
                <span className="rounded bg-emerald-800 px-2 py-0.5 text-xs font-semibold text-white">
                  Line #{line.lineNumber}
                </span>
                <span className="font-semibold">{line.title}</span>
                {line.customerEdited ? (
                  <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                    Manual edit kept at save
                  </span>
                ) : (
                  <span className="rounded border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
                    Synced from company
                  </span>
                )}
                <span className="ml-auto font-medium">{formatMoney(line.total)}</span>
              </div>
              <pre className="whitespace-pre-wrap px-3 py-3 font-mono text-sm">
                {line.description || '—'}
              </pre>
            </div>
          ))}
          <div className="flex justify-end border-t pt-3 text-base font-semibold">
            Customer total:{' '}
            {formatMoney(derivedCustomer.reduce((sum, line) => sum + (line.total || 0), 0))}
          </div>
        </TabsContent>
      </Tabs>
    </ResponsivePage>
  )
}
