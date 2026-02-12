'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

interface PublicInvoice {
  id: string
  invoiceNumber: string
  title: string
  status: string
  subtotal: string
  taxAmount: string
  total: string
  balance: string
  invoiceDate: string
  dueDate: string | null
  client: {
    name: string
    companyName: string | null
  }
  lineItems: Array<{
    id: string
    description: string
    quantity: string
    unitPrice: string
    total: string
  }>
}

function toCurrency(value: string | number) {
  const n = typeof value === 'number' ? value : Number(value || 0)
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export default function PublicPaymentPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const invoiceId = params.invoiceId as string
  const token = searchParams.get('token') || ''

  const [invoice, setInvoice] = useState<PublicInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  useEffect(() => {
    const fetchInvoice = async () => {
      if (!token) {
        setError('Missing payment token.')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/public/invoices/${invoiceId}?token=${encodeURIComponent(token)}`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          setError(data.error || 'Unable to load invoice.')
          return
        }
        setInvoice(data.invoice)
      } catch {
        setError('Unable to load invoice.')
      } finally {
        setLoading(false)
      }
    }

    fetchInvoice()
  }, [invoiceId, token])

  const isPaid = useMemo(() => Number(invoice?.balance || 0) <= 0, [invoice?.balance])

  const handlePayNow = async () => {
    if (!invoice || !approved || processing) return
    setProcessing(true)
    try {
      const response = await fetch(`/api/public/invoices/${invoice.id}/payment-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.paymentUrl) {
        setError(data.error || 'Unable to create payment link.')
        return
      }
      window.location.href = data.paymentUrl
    } catch {
      setError('Unable to redirect to payment.')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-600">Loading invoice...</div>
  }

  if (error) {
    return <div className="p-8 text-center text-red-600">{error}</div>
  }

  if (!invoice) {
    return <div className="p-8 text-center text-red-600">Invoice not found.</div>
  }

  if (isPaid) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Payment Complete</CardTitle>
          </CardHeader>
          <CardContent>
            <p>This invoice has already been paid. Thank you.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Trim Pro Payment Portal</h1>
        <p className="text-gray-600">Invoice {invoice.invoiceNumber}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{invoice.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-gray-700">
            <div>Client: {invoice.client.name}</div>
            <div>Date: {new Date(invoice.invoiceDate).toLocaleDateString()}</div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left">Description</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((li) => (
                  <tr key={li.id} className="border-b">
                    <td className="py-2">{li.description}</td>
                    <td className="py-2 text-right">{li.quantity}</td>
                    <td className="py-2 text-right">{toCurrency(li.unitPrice)}</td>
                    <td className="py-2 text-right">{toCurrency(li.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{toCurrency(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <span>{toCurrency(invoice.taxAmount)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 font-bold">
              <span>Balance Due</span>
              <span>{toCurrency(invoice.balance)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-md border p-3">
            <Checkbox
              id="approve-invoice"
              checked={approved}
              onCheckedChange={(checked) => setApproved(Boolean(checked))}
            />
            <label htmlFor="approve-invoice" className="text-sm">
              I approve this invoice and authorize payment.
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                window.open(`/api/public/invoices/${invoice.id}/pdf?token=${encodeURIComponent(token)}`, '_blank')
              }
            >
              Download Invoice PDF
            </Button>
            <Button disabled={!approved || processing} onClick={handlePayNow}>
              {processing ? 'Redirecting...' : 'Pay Now (Card / ACH)'}
            </Button>
          </div>
          {confirmation && <p className="text-green-600 text-sm">{confirmation}</p>}
        </CardContent>
      </Card>
    </div>
  )
}

