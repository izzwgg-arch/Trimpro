'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface PublicInvoice {
  id: string
  invoiceNumber: string
  title: string
  status: string
  subtotal: string
  taxAmount: string
  total: string
  balance: string
  qboAchEnabled?: boolean
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
  const gatewayResult = searchParams.get('xResult') || searchParams.get('Result') || ''
  const gatewayStatus = searchParams.get('status') || searchParams.get('xStatus') || ''
  const gatewayRef =
    searchParams.get('xRefnum') ||
    searchParams.get('xRefNum') ||
    searchParams.get('transactionId') ||
    searchParams.get('transaction_id') ||
    ''
  const gatewayInvoice = searchParams.get('xInvoice') || searchParams.get('invoiceId') || ''
  const gatewayAmount = searchParams.get('xAmount') || searchParams.get('amount') || ''

  const [invoice, setInvoice] = useState<PublicInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [reconcilingPayment, setReconcilingPayment] = useState(false)
  const [manualSyncing, setManualSyncing] = useState(false)
  const [achProcessing, setAchProcessing] = useState(false)
  const [showPayChoice, setShowPayChoice] = useState(false)

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

  useEffect(() => {
    // Auto-prompt payment method selection when arriving from the invoice email.
    // If the user is returning from a gateway (card) redirect, don't interrupt with a modal.
    const hasGatewayProof = Boolean(gatewayResult || gatewayStatus || gatewayRef || gatewayAmount)
    const unpaid = Number(invoice?.balance || 0) > 0
    if (!loading && !error && invoice && unpaid && approved && !hasGatewayProof) {
      setShowPayChoice(true)
    } else {
      setShowPayChoice(false)
    }
    // Only react to changes that indicate a new arrival/ready-to-pay state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, invoice?.id, invoice?.balance, approved])

  const refreshInvoice = async () => {
    if (!token) return
    try {
      const response = await fetch(`/api/public/invoices/${invoiceId}?token=${encodeURIComponent(token)}`)
      const data = await response.json().catch(() => ({}))
      if (response.ok && data.invoice) {
        setInvoice(data.invoice)
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const normalizedResult = String(gatewayResult || '').toUpperCase()
    const normalizedStatus = String(gatewayStatus || '').toLowerCase()
    const looksFailed =
      ['D', 'DECLINED', 'ERROR', 'FAILED', 'CANCELLED'].includes(normalizedResult) ||
      ['failed', 'declined', 'canceled', 'cancelled', 'error'].includes(normalizedStatus)
    const hasGatewayProof = Boolean(gatewayResult || gatewayStatus || gatewayRef || gatewayAmount)
    const shouldReconcile = Boolean(token && hasGatewayProof && !looksFailed)
    if (!shouldReconcile || reconcilingPayment) return

    const reconcileFromReturn = async () => {
      try {
        setReconcilingPayment(true)
        const body = new URLSearchParams()
        if (gatewayResult) body.set('xResult', gatewayResult)
        if (gatewayRef) body.set('xRefnum', gatewayRef)
        if (gatewayInvoice) body.set('xInvoice', gatewayInvoice)
        if (gatewayAmount) body.set('xAmount', gatewayAmount)
        if (gatewayStatus) body.set('status', gatewayStatus)
        if (!gatewayResult && (gatewayRef || gatewayStatus)) {
          // Some Cardknox return flows omit xResult. Treat return with transaction proof as approved.
          body.set('status', 'approved')
        }
        body.set('invoiceId', gatewayInvoice || invoiceId)
        body.set('xInvoice', gatewayInvoice || invoiceId)

        await fetch('/api/webhooks/sola-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })

        const response = await fetch(`/api/public/invoices/${invoiceId}?token=${encodeURIComponent(token)}`)
        const data = await response.json().catch(() => ({}))
        if (response.ok && data.invoice) {
          setInvoice(data.invoice)
          setConfirmation('Payment received. Invoice status was updated.')
        }
      } catch {
        // Ignore UI errors here; webhook/server logs capture failures.
      } finally {
        setReconcilingPayment(false)
      }
    }

    reconcileFromReturn()
  }, [
    token,
    invoiceId,
    gatewayResult,
    gatewayRef,
    gatewayInvoice,
    gatewayAmount,
    reconcilingPayment,
  ])

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

  const handlePayByAch = async () => {
    if (!invoice || !approved || achProcessing) return
    setAchProcessing(true)
    setError(null)
    try {
      const response = await fetch(`/api/public/invoices/${invoice.id}/qbo-ach-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.hostedUrl) {
        setError(data.error || 'Unable to start ACH payment.')
        return
      }

      // Redirect in the same tab so the flow feels "automatic".
      window.location.href = data.hostedUrl
    } catch {
      setError('Unable to redirect to ACH payment.')
    } finally {
      setAchProcessing(false)
    }
  }

  const handleManualSync = async () => {
    if (!invoice || manualSyncing) return
    const parsedAmount = Number(invoice.balance || 0)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return
    setManualSyncing(true)
    try {
      const body = new URLSearchParams()
      body.set('xResult', 'A')
      body.set('xInvoice', invoice.invoiceNumber)
      body.set('xAmount', parsedAmount.toFixed(2))
      body.set('xRefnum', gatewayRef || `MANUAL-${Date.now()}`)
      body.set('invoiceId', invoice.invoiceNumber)

      const response = await fetch('/api/webhooks/sola-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || 'Unable to sync payment.')
        return
      }

      const refreshed = await fetch(`/api/public/invoices/${invoice.id}?token=${encodeURIComponent(token)}`)
      const refreshedData = await refreshed.json().catch(() => ({}))
      if (refreshed.ok && refreshedData.invoice) {
        setInvoice(refreshedData.invoice)
        setConfirmation('Payment synced. Invoice status updated.')
      }
    } catch {
      setError('Unable to sync payment.')
    } finally {
      setManualSyncing(false)
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

          <Dialog open={showPayChoice} onOpenChange={setShowPayChoice}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>How would you like to pay?</DialogTitle>
                <DialogDescription>
                  Choose a payment method to continue. Card payments are processed via our card processor. ACH opens a
                  QuickBooks-hosted payment page.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Button
                  disabled={!approved || processing}
                  onClick={() => {
                    setShowPayChoice(false)
                    handlePayNow()
                  }}
                >
                  {processing ? 'Redirecting...' : 'Pay by Card'}
                </Button>
                <Button
                  variant="outline"
                  disabled={!approved || achProcessing || !invoice.qboAchEnabled}
                  onClick={() => {
                    setShowPayChoice(false)
                    handlePayByAch()
                  }}
                  title={!invoice.qboAchEnabled ? 'ACH is not enabled for this invoice' : 'Pay by ACH via QuickBooks'}
                >
                  {achProcessing ? 'Redirecting...' : 'Pay by ACH'}
                </Button>
                {!invoice.qboAchEnabled && (
                  <div className="text-xs text-gray-600">
                    ACH isn’t enabled for this invoice. Please choose Card or contact the office.
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                window.open(`/api/public/invoices/${invoice.id}/pdf?token=${encodeURIComponent(token)}`, '_blank')
              }
            >
              Download Invoice PDF
            </Button>
            <Button variant="outline" onClick={refreshInvoice} disabled={loading}>
              Refresh
            </Button>
            <Button variant="outline" disabled={manualSyncing} onClick={handleManualSync}>
              {manualSyncing ? 'Syncing...' : 'I Paid - Sync Now'}
            </Button>
          </div>

          <div className="rounded-lg border bg-gray-50 p-3">
            <div className="text-sm font-semibold text-gray-900">How would you like to pay?</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={!approved || processing} onClick={handlePayNow}>
                {processing ? 'Redirecting...' : 'Pay by Card'}
              </Button>
              <Button
                variant="outline"
                disabled={!approved || achProcessing || !invoice.qboAchEnabled}
                onClick={handlePayByAch}
                title={!invoice.qboAchEnabled ? 'ACH is not enabled for this invoice' : 'Pay by ACH via QuickBooks'}
              >
                {achProcessing ? 'Redirecting...' : 'Pay by ACH'}
              </Button>
            </div>
            <div className="mt-2 text-xs text-gray-600">
              Card payments are processed via our card processor. ACH payments open a QuickBooks-hosted payment page.
              After payment completes, this page will update once the receipt is received.
            </div>
          </div>
          {reconcilingPayment && <p className="text-sm text-gray-600">Confirming payment status...</p>}
          {confirmation && <p className="text-green-600 text-sm">{confirmation}</p>}
        </CardContent>
      </Card>
    </div>
  )
}

