'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Download, FileText, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { SearchableClientSelect } from '@/components/ui/searchable-client-select'
import { Checkbox } from '@/components/ui/checkbox'
import { fetchAllPickerClients, type PickerClient } from '@/lib/clients/fetch-all-picker-clients'
import { downloadReportExport } from '@/lib/reports/download-export'

type LedgerRow = {
  date: string
  type: 'INVOICE' | 'PAYMENT' | 'CREDIT_MEMO'
  description: string
  reference: string
  debit: number
  credit: number
  balance: number
}

type StatementResponse = {
  client: { id: string; name: string; companyName: string | null }
  ledger: LedgerRow[]
  summary: {
    totalInvoiced: number
    totalPaid: number
    totalCredited: number
    balance: number
    invoiceCount: number
  }
}

const TYPE_LABEL: Record<LedgerRow['type'], string> = {
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
  CREDIT_MEMO: 'Credit Memo',
}

export default function CustomerStatementReportPage() {
  const searchParams = useSearchParams()
  const [clients, setClients] = useState<PickerClient[]>([])
  const [clientId, setClientId] = useState(searchParams.get('clientId') || '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [jobSiteAddress, setJobSiteAddress] = useState('')
  const [hideSubClients, setHideSubClients] = useState(true)
  const [data, setData] = useState<StatementResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllPickerClients()
      .then(setClients)
      .catch(() => setError('Failed to load clients'))
  }, [])

  const buildQuery = () => {
    const params = new URLSearchParams({ clientId })
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (jobSiteAddress) params.set('jobSiteAddress', jobSiteAddress)
    params.set('hideSubClients', String(hideSubClients))
    return params
  }

  useEffect(() => {
    if (!clientId) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    const token = localStorage.getItem('accessToken')
    fetch(`/api/reports/customer-statement?${buildQuery().toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to load statement')
        return res.json()
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, startDate, endDate, jobSiteAddress, hideSubClients])

  const handleExport = async (format: 'csv' | 'pdf') => {
    if (!clientId || !data) return
    setExporting(true)
    try {
      const params = buildQuery()
      params.set('format', format)
      await downloadReportExport(
        `/api/reports/customer-statement?${params.toString()}`,
        `statement-${data.client.name}.${format}`
      )
    } catch {
      alert(`Failed to export ${format.toUpperCase()}`)
    } finally {
      setExporting(false)
    }
  }

  const handlePrint = async () => {
    if (!clientId) return
    const params = buildQuery()
    params.set('format', 'html')
    const token = localStorage.getItem('accessToken')
    const res = await fetch(`/api/reports/customer-statement?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const html = await res.text()
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      alert('Popup blocked. Please allow popups to print.')
      return
    }
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.addEventListener('load', () => printWindow.print())
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/reports">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customer Statement</h1>
          <p className="text-sm text-gray-500">Invoices, payments applied, and running balance for a customer</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <div>
            <Label>Customer *</Label>
            <SearchableClientSelect clients={clients} value={clientId} onSelect={setClientId} placeholder="Select a customer..." />
          </div>
          <div>
            <Label>Start Date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label>End Date</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <Label>Job Site Address</Label>
            <Input
              value={jobSiteAddress}
              onChange={(e) => setJobSiteAddress(e.target.value)}
              placeholder="Street, city, state, or zip"
            />
          </div>
          <div className="flex items-center gap-2 pt-6 sm:col-span-4">
            <Checkbox
              id="hideSubClients"
              checked={hideSubClients}
              onCheckedChange={(v) => setHideSubClients(v === true)}
            />
            <Label htmlFor="hideSubClients" className="!mb-0 cursor-pointer font-normal">
              Include this customer's sub-customers, consolidated into one statement
            </Label>
          </div>
        </CardContent>
      </Card>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {loading && <div className="text-sm text-gray-500">Loading statement...</div>}

      {data && !loading && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-gray-500">Total Invoiced</div>
                <div className="text-xl font-bold">${data.summary.totalInvoiced.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-gray-500">Total Paid</div>
                <div className="text-xl font-bold text-green-700">${data.summary.totalPaid.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-gray-500">Total Credited</div>
                <div className="text-xl font-bold text-blue-700">${data.summary.totalCredited.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-gray-500">Balance Due</div>
                <div className={`text-xl font-bold ${data.summary.balance > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  ${data.summary.balance.toFixed(2)}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Transaction Ledger</CardTitle>
                <CardDescription>{data.client.companyName || data.client.name}</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-1" /> Print
                </Button>
                <Button variant="outline" size="sm" disabled={exporting} onClick={() => handleExport('csv')}>
                  <Download className="h-4 w-4 mr-1" /> CSV
                </Button>
                <Button variant="outline" size="sm" disabled={exporting} onClick={() => handleExport('pdf')}>
                  <FileText className="h-4 w-4 mr-1" /> PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Reference</th>
                      <th className="py-2 pr-3">Description</th>
                      <th className="py-2 pr-3 text-right">Debit</th>
                      <th className="py-2 pr-3 text-right">Credit</th>
                      <th className="py-2 pr-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-gray-400">
                          No transactions in this period
                        </td>
                      </tr>
                    ) : (
                      data.ledger.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 pr-3">{new Date(row.date).toLocaleDateString()}</td>
                          <td className="py-2 pr-3">{TYPE_LABEL[row.type]}</td>
                          <td className="py-2 pr-3">{row.reference}</td>
                          <td className="py-2 pr-3">{row.description}</td>
                          <td className="py-2 pr-3 text-right">{row.debit ? `$${row.debit.toFixed(2)}` : ''}</td>
                          <td className="py-2 pr-3 text-right">{row.credit ? `$${row.credit.toFixed(2)}` : ''}</td>
                          <td className="py-2 pr-3 text-right font-medium">${row.balance.toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
