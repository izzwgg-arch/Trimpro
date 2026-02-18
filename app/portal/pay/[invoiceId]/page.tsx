'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Script from 'next/script'
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
  outstanding?: {
    count: number
    total: number
    invoices: Array<{
      id: string
      invoiceNumber: string
      balance: string
      invoiceDate: string
      dueDate: string | null
      isCurrent: boolean
    }>
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
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([])
  const [showOutstanding, setShowOutstanding] = useState(true)
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null)
  const [previewInvoice, setPreviewInvoice] = useState<PublicInvoice | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewSelectedLineItemIds, setPreviewSelectedLineItemIds] = useState<string[]>([])
  const [partialSelection, setPartialSelection] = useState<{
    invoiceId: string
    invoiceNumber: string
    lineItemIds: string[]
    amount: number
  } | null>(null)
  const [processing, setProcessing] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [reconcilingPayment, setReconcilingPayment] = useState(false)
  const [manualSyncing, setManualSyncing] = useState(false)
  const [achProcessing, setAchProcessing] = useState(false)

  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState<string>(
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || ''
  )
  const [recaptchaScriptLoaded, setRecaptchaScriptLoaded] = useState(false)

  useEffect(() => {
    // Global CSS disables body scroll; portal pages need natural scrolling.
    // Keep it scoped to this page so we don't affect the authenticated dashboard.
    const body = document.body
    const prev = body.getAttribute('data-allow-scroll')
    body.setAttribute('data-allow-scroll', 'true')
    return () => {
      if (prev == null) body.removeAttribute('data-allow-scroll')
      else body.setAttribute('data-allow-scroll', prev)
    }
  }, [])

  useEffect(() => {
    // Client-side env vars are baked at build time; fetch a runtime fallback if missing.
    if (recaptchaSiteKey) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/public/recaptcha/site-key')
        const data = await res.json().catch(() => ({}))
        const key = String(data?.siteKey || '')
        if (!cancelled && key) setRecaptchaSiteKey(key)
      } catch {
        // ignore; server will still enforce captcha and return a clear error
      }
    })()
    return () => {
      cancelled = true
    }
  }, [recaptchaSiteKey])

  const getRecaptchaToken = async (action: string): Promise<string> => {
    if (!recaptchaSiteKey) {
      throw new Error('reCAPTCHA is not configured')
    }
    const grecaptcha = (window as any).grecaptcha
    if (!grecaptcha?.ready) {
      throw new Error('reCAPTCHA is still loading. Please try again in a second.')
    }
    await new Promise<void>((resolve) => grecaptcha.ready(() => resolve()))
    const token = await grecaptcha.execute(recaptchaSiteKey, { action })
    return String(token || '')
  }
  const captchaReady = Boolean(recaptchaSiteKey && recaptchaScriptLoaded)

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
        // Default selection: current invoice; if only one open invoice, keep it.
        const open = Array.isArray(data?.invoice?.outstanding?.invoices) ? data.invoice.outstanding.invoices : []
        const currentId = String(data?.invoice?.id || invoiceId)
        const currentIsOpen = open.some((x: any) => String(x?.id) === currentId)
        setSelectedInvoiceIds(currentIsOpen ? [currentId] : open.length ? [String(open[0].id)] : [currentId])
      } catch {
        setError('Unable to load invoice.')
      } finally {
        setLoading(false)
      }
    }

    fetchInvoice()
  }, [invoiceId, token])

  useEffect(() => {
    const loadPreview = async () => {
      if (!previewInvoiceId) {
        setPreviewInvoice(null)
        return
      }
      if (!token) return
      setPreviewLoading(true)
      try {
        const res = await fetch(`/api/public/invoices/preview?token=${encodeURIComponent(token)}&id=${encodeURIComponent(previewInvoiceId)}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error || 'Unable to load invoice preview.')
          setPreviewInvoice(null)
          return
        }
        setPreviewInvoice(data.invoice || null)
      } catch {
        setError('Unable to load invoice preview.')
        setPreviewInvoice(null)
      } finally {
        setPreviewLoading(false)
      }
    }
    loadPreview()
  }, [previewInvoiceId, token])

  useEffect(() => {
    // When preview loads, default to selecting all items (full invoice amount) for convenience.
    if (!previewInvoice) return
    setPreviewSelectedLineItemIds((prev) => (prev.length ? prev : (previewInvoice.lineItems || []).map((li) => li.id)))
  }, [previewInvoice])

  useEffect(() => {
    // Partial selection only makes sense when paying exactly one invoice.
    if (!partialSelection) return
    if (selectedInvoiceIds.length !== 1 || selectedInvoiceIds[0] !== partialSelection.invoiceId) {
      setPartialSelection(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInvoiceIds])

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
  const outstandingCount = Number(invoice?.outstanding?.count || 0)
  const outstandingTotal = Number(invoice?.outstanding?.total || 0)
  const openInvoices = Array.isArray(invoice?.outstanding?.invoices) ? invoice!.outstanding!.invoices : []
  const selectedTotal = useMemo(() => {
    if (partialSelection && selectedInvoiceIds.length === 1 && selectedInvoiceIds[0] === partialSelection.invoiceId) {
      return Number(partialSelection.amount || 0)
    }
    const byId = new Map(openInvoices.map((i) => [String(i.id), Number(i.balance || 0)]))
    return selectedInvoiceIds.reduce((sum, id) => sum + Math.max(0, Number(byId.get(String(id)) || 0)), 0)
  }, [openInvoices, selectedInvoiceIds, partialSelection])
  const selectAllChecked = openInvoices.length > 0 && selectedInvoiceIds.length === openInvoices.length
  const selectAllIndeterminate = selectedInvoiceIds.length > 0 && selectedInvoiceIds.length < openInvoices.length

  const handlePayNow = async () => {
    if (!invoice || !approved || processing) return
    if (selectedInvoiceIds.length === 0) {
      setError('Select at least one invoice to pay.')
      return
    }
    setProcessing(true)
    try {
      const recaptchaToken = await getRecaptchaToken('public_invoice_pay_card')
      const payload: any = { token, recaptchaToken, selectedInvoiceIds }
      if (
        partialSelection &&
        selectedInvoiceIds.length === 1 &&
        selectedInvoiceIds[0] === partialSelection.invoiceId &&
        partialSelection.lineItemIds.length > 0
      ) {
        payload.partialInvoiceId = partialSelection.invoiceId
        payload.partialLineItemIds = partialSelection.lineItemIds
      }
      const response = await fetch(`/api/public/invoices/${invoice.id}/payment-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.paymentUrl) {
        setError(data.error || 'Unable to create payment link.')
        return
      }
      window.location.href = data.paymentUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to redirect to payment.')
    } finally {
      setProcessing(false)
    }
  }

  const handlePayByAch = async () => {
    if (!invoice || !approved || achProcessing) return
    if (partialSelection) {
      setError('Partial payments are currently available for card payments only.')
      return
    }
    if (selectedInvoiceIds.length !== 1) {
      setError('To pay by ACH, select exactly 1 invoice (QuickBooks ACH is per-invoice).')
      return
    }
    setAchProcessing(true)
    setError(null)
    try {
      const recaptchaToken = await getRecaptchaToken('public_invoice_pay_ach')
      const response = await fetch(`/api/public/invoices/${invoice.id}/qbo-ach-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, recaptchaToken, targetInvoiceId: selectedInvoiceIds[0] }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.hostedUrl) {
        setError(data.error || 'Unable to start ACH payment.')
        return
      }

      // Redirect in the same tab so the flow feels "automatic".
      window.location.href = data.hostedUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to redirect to ACH payment.')
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

  if (!invoice) {
    if (error) {
      return <div className="p-8 text-center text-red-600">{error}</div>
    }
    return <div className="p-8 text-center text-red-600">Invoice not found.</div>
  }

  if (isPaid) {
    return (
    <div className="mx-auto max-w-3xl p-6 min-h-screen overflow-y-auto">
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
    <div className="mx-auto max-w-4xl space-y-6 p-6 min-h-screen overflow-y-auto">
      {previewInvoiceId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-lg bg-white shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-semibold">
                Invoice Preview{previewInvoice?.invoiceNumber ? ` • ${previewInvoice.invoiceNumber}` : ''}
              </div>
              <Button variant="outline" size="sm" onClick={() => setPreviewInvoiceId(null)}>
                Close
              </Button>
            </div>
            <div className="max-h-[80vh] overflow-y-auto p-4">
              {previewLoading ? (
                <div className="text-sm text-gray-600">Loading preview...</div>
              ) : !previewInvoice ? (
                <div className="text-sm text-gray-600">No preview available.</div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-base font-semibold">
                        {previewInvoice.title || `Invoice ${previewInvoice.invoiceNumber}`}
                      </div>
                      <div className="text-xs text-gray-600">
                        {previewInvoice.client?.name || 'Client'} •{' '}
                        {previewInvoice.invoiceDate ? new Date(previewInvoice.invoiceDate).toLocaleDateString() : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-600">Balance</div>
                      <div className="text-lg font-bold">{toCurrency(previewInvoice.balance)}</div>
                    </div>
                  </div>

                  <div className="rounded border">
                    <div className="grid grid-cols-12 gap-2 border-b bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">
                      <div className="col-span-1"></div>
                      <div className="col-span-6">Description</div>
                      <div className="col-span-2 text-right">Qty</div>
                      <div className="col-span-2 text-right">Unit</div>
                      <div className="col-span-2 text-right">Total</div>
                    </div>
                    <div className="divide-y">
                      {(previewInvoice.lineItems || []).map((li) => {
                        const checked = previewSelectedLineItemIds.includes(li.id)
                        return (
                        <div key={li.id} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs">
                          <div className="col-span-1">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                const next = Boolean(v)
                                setPreviewSelectedLineItemIds((prev) =>
                                  next ? Array.from(new Set([...prev, li.id])) : prev.filter((x) => x !== li.id)
                                )
                              }}
                            />
                          </div>
                          <div className="col-span-6">{li.description}</div>
                          <div className="col-span-2 text-right">{li.quantity}</div>
                          <div className="col-span-2 text-right">{toCurrency(li.unitPrice)}</div>
                          <div className="col-span-2 text-right">{toCurrency(li.total)}</div>
                        </div>
                      )})}
                    </div>
                  </div>

                  <div className="ml-auto max-w-xs space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>{toCurrency(previewInvoice.subtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tax</span>
                      <span>{toCurrency(previewInvoice.taxAmount)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 font-bold">
                      <span>Balance Due</span>
                      <span>{toCurrency(previewInvoice.balance)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <div className="mr-auto text-xs text-gray-700">
                      Selected items:{' '}
                      <span className="font-semibold">
                        {previewSelectedLineItemIds.length}
                      </span>{' '}
                      • Amount:{' '}
                      <span className="font-semibold">
                        {toCurrency(
                          (previewInvoice.lineItems || [])
                            .filter((li) => previewSelectedLineItemIds.includes(li.id))
                            .reduce((sum, li) => sum + Math.max(0, Number(li.total || 0)), 0)
                        )}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!previewInvoice?.id) return
                        window.open(
                          `/api/public/invoices/${previewInvoice.id}/pdf?token=${encodeURIComponent(token)}`,
                          '_blank'
                        )
                      }}
                    >
                      Download PDF
                    </Button>
                    <Button
                      onClick={() => {
                        if (!previewInvoice?.id) return
                        const amount = (previewInvoice.lineItems || [])
                          .filter((li) => previewSelectedLineItemIds.includes(li.id))
                          .reduce((sum, li) => sum + Math.max(0, Number(li.total || 0)), 0)

                        if (!Number.isFinite(amount) || amount <= 0) {
                          setError('Select at least one item to pay.')
                          return
                        }

                        setSelectedInvoiceIds([previewInvoice.id])
                        setPartialSelection({
                          invoiceId: previewInvoice.id,
                          invoiceNumber: previewInvoice.invoiceNumber,
                          lineItemIds: previewSelectedLineItemIds,
                          amount,
                        })
                        setPreviewInvoiceId(null)
                      }}
                    >
                      Pay selected items
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {recaptchaSiteKey ? (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(recaptchaSiteKey)}`}
          strategy="afterInteractive"
          onLoad={() => setRecaptchaScriptLoaded(true)}
        />
      ) : null}
      <div>
        <h1 className="text-3xl font-bold">Trim Pro Payment Portal</h1>
        <p className="text-gray-600">Invoice {invoice.invoiceNumber}</p>
      </div>
      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {partialSelection ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-center justify-between gap-2">
          <div className="min-w-0">
            Partial payment selected: <span className="font-semibold">{toCurrency(partialSelection.amount)}</span> for invoice{' '}
            <span className="font-semibold">{partialSelection.invoiceNumber}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setPartialSelection(null)}>
            Clear
          </Button>
        </div>
      ) : null}

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
              {selectedInvoiceIds.length > 1
                ? 'I approve these invoices and authorize payment.'
                : 'I approve this invoice and authorize payment.'}
            </label>
          </div>

          {invoice?.outstanding && outstandingCount > 0 ? (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  You have {outstandingCount} open invoice{outstandingCount === 1 ? '' : 's'} totaling{' '}
                  <span className="font-semibold">{toCurrency(outstandingTotal)}</span>.
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowOutstanding((s) => !s)}>
                  {showOutstanding ? 'Hide' : 'Review'}
                </Button>
              </div>

              {showOutstanding ? (
                <div className="mt-3 rounded border bg-gray-50 p-2">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-medium text-gray-600">Select invoices to pay</div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="select-all"
                        checked={selectAllChecked}
                        onCheckedChange={(checked) => {
                          const next = Boolean(checked)
                          setSelectedInvoiceIds(next ? openInvoices.map((i) => String(i.id)) : [])
                        }}
                      />
                      <label htmlFor="select-all" className="text-xs text-gray-700">
                        Select all
                        {selectAllIndeterminate ? ' (partial)' : ''}
                      </label>
                    </div>
                  </div>

                  <div className="max-h-56 overflow-auto rounded bg-white border">
                    {(invoice.outstanding.invoices || []).map((inv) => {
                      const id = String(inv.id)
                      const checked = selectedInvoiceIds.includes(id)
                      return (
                        <div
                          key={id}
                          className="flex items-center justify-between gap-2 px-2 py-2 border-b last:border-b-0 cursor-pointer hover:bg-gray-50"
                          onClick={() => setPreviewInvoiceId(id)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                const next = Boolean(v)
                                setSelectedInvoiceIds((prev) =>
                                  next ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)
                                )
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-medium truncate">
                                {inv.invoiceNumber}
                                {inv.isCurrent ? ' (this page)' : ''}
                              </div>
                              <div className="text-[11px] text-gray-500 truncate">Click to preview</div>
                            </div>
                          </div>
                          <div className="text-xs font-semibold">{toCurrency(inv.balance)}</div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="mt-2 text-xs text-gray-700">
                    Selected: <span className="font-semibold">{selectedInvoiceIds.length}</span> invoice(s) • Amount:{' '}
                    <span className="font-semibold">{toCurrency(selectedTotal)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

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
            <div className="mt-1 text-xs text-gray-600">
              Amount to pay: <span className="font-semibold">{toCurrency(selectedTotal || invoice.balance)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                disabled={!approved || achProcessing || !captchaReady || selectedInvoiceIds.length !== 1}
                onClick={handlePayByAch}
                title="Pay by ACH via QuickBooks"
              >
                {achProcessing ? 'Redirecting...' : 'Pay by ACH'}
              </Button>
              <Button
                variant="outline"
                disabled={!approved || processing || !captchaReady}
                onClick={handlePayNow}
              >
                {processing
                  ? 'Redirecting...'
                  : selectedInvoiceIds.length > 1
                    ? 'Pay Selected by Card'
                    : 'Pay by Card'}
              </Button>
            </div>
            {!recaptchaSiteKey ? (
              <div className="mt-2 text-xs text-red-600">
                Payment security check is not configured. Please contact support.
              </div>
            ) : !recaptchaScriptLoaded ? (
              <div className="mt-2 text-xs text-gray-500">Loading security check...</div>
            ) : null}
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

