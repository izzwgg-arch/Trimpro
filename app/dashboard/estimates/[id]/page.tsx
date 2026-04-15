'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import { splitEmailList } from '@/lib/email'
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  Mail,
  User,
  Building2,
  FileText,
  Send,
  Download,
  Edit,
  ChevronDown,
  ChevronRight,
  Package,
  Trash2,
  RefreshCw,
  Unlink,
  Plus,
  Printer,
  Copy,
} from 'lucide-react'
import Link from 'next/link'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { DocumentAttachments } from '@/components/common/document-attachments'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { buildCreateContextQuery } from '@/src/lib/create-context'

interface EstimateDetail {
  id: string
  estimateNumber: string
  title: string
  jobSiteAddress: string | null
  status: string
  convertedPercent?: number | null
  subtotal: string
  taxRate: string
  taxAmount: string
  discount: string
  total: string
  validUntil: string | null
  notes: string | null
  terms: string | null
  isNotesVisibleToClient?: boolean
  createdAt: string
  updatedAt: string
  client: {
    id: string
    name: string
    companyName: string | null
    contacts: Array<{
      id: string
      firstName: string
      lastName: string
      phone: string | null
      email: string | null
    }>
  } | null
  lead: {
    id: string
    firstName: string
    lastName: string
  } | null
  job: {
    id: string
    jobNumber: string
    title: string
  } | null
  lineItems: Array<{
    id: string
    description: string
    quantity: string
    unitPrice: string
    unitCost?: string | null
    notes?: string | null
    total: string
    sortOrder: number
    isVisibleToClient?: boolean
    isSubtotal?: boolean
    groupId: string | null
    group: {
      id: string
      name: string
      sourceBundleId: string | null
      sourceBundleName: string | null
    } | null
    sourceItemId: string | null
    sourceItem: {
      id: string
      name: string
      kind: string
    } | null
  }>
  optionalItems?: Array<{
    id: string
    description: string
    quantity: string
    unitPrice: string
    unitCost?: string | null
    notes?: string | null
    total: string
    sortOrder: number
    isVisibleToClient?: boolean
  }>
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SENT: 'bg-blue-100 text-blue-800',
  VIEWED: 'bg-purple-100 text-purple-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-yellow-100 text-yellow-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
}

export default function EstimateDetailPage() {
  const params = useParams()
  const router = useRouter()
  const estimateId = params.id as string
  const [estimate, setEstimate] = useState<EstimateDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [processingGroup, setProcessingGroup] = useState<string | null>(null)
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null)
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [itemPickerGroupId, setItemPickerGroupId] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [showBillingModal, setShowBillingModal] = useState(false)
  const [convertingInvoice, setConvertingInvoice] = useState(false)
  const [billingMode, setBillingMode] = useState<'FULL' | 'PERCENTAGE' | 'MANUAL'>('FULL')
  const [billingPercent, setBillingPercent] = useState('50')
  const [selectedLineItemIds, setSelectedLineItemIds] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [showSendModal, setShowSendModal] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [sendToPreset, setSendToPreset] = useState<string>('custom')
  const [sendSubject, setSendSubject] = useState('')
  const [sendMessage, setSendMessage] = useState('')

  const [approvalInfo, setApprovalInfo] = useState<{
    approveUrl: string
    expiresAt: string | null
    approvals: any[]
    invoiceHistory: any[]
  } | null>(null)
  const [loadingApprovals, setLoadingApprovals] = useState(false)
  const [regeneratingApprovalLink, setRegeneratingApprovalLink] = useState(false)
  const [reimportingLines, setReimportingLines] = useState(false)

  useEffect(() => {
    fetchEstimate()
  }, [estimateId])

  const fetchApprovals = async () => {
    try {
      setLoadingApprovals(true)
      const token = localStorage.getItem('accessToken')
      if (!token) return
      const res = await fetch(`/api/estimates/${estimateId}/approvals`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      if (data?.approveUrl) setApprovalInfo(data)
    } catch (e) {
      console.error('Failed to fetch estimate approvals:', e)
    } finally {
      setLoadingApprovals(false)
    }
  }

  useEffect(() => {
    if (!estimateId) return
    fetchApprovals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateId])

  const handleCopyApprovalLink = async () => {
    const url = approvalInfo?.approveUrl
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      alert('Approval link copied.')
    } catch {
      // Fallback
      prompt('Copy approval link:', url)
    }
  }

  const handleRegenerateApprovalLink = async () => {
    if (!confirm('Regenerate approval link? This will revoke the old link.')) return
    try {
      setRegeneratingApprovalLink(true)
      const token = localStorage.getItem('accessToken')
      if (!token) return
      const res = await fetch(`/api/estimates/${estimateId}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'regenerate' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.error || 'Failed to regenerate link')
        return
      }
      setApprovalInfo((prev) =>
        prev ? { ...prev, approveUrl: data.approveUrl, expiresAt: data.expiresAt || null } : prev
      )
    } catch (e) {
      console.error('Regenerate approval link error:', e)
      alert('Failed to regenerate link')
    } finally {
      setRegeneratingApprovalLink(false)
    }
  }

  const fetchEstimate = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/estimates/${estimateId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401) {
        router.push('/auth/login')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        console.error('Failed to fetch estimate:', error)
        setEstimate(null)
        setLoading(false)
        return
      }

      const data = await response.json()
      if (data.estimate) {
        setEstimate(data.estimate)
      } else {
        setEstimate(null)
      }
    } catch (error) {
      console.error('Failed to fetch estimate:', error)
      setEstimate(null)
    } finally {
      setLoading(false)
    }
  }

  const fetchPdfHtml = async (print = false) => {
    const token = localStorage.getItem('accessToken')
    if (!token) {
      router.push('/auth/login')
      throw new Error('Not authenticated')
    }

    const qs = new URLSearchParams()
    qs.set('format', 'html')
    if (print) qs.set('print', '1')
    const response = await fetch(`/api/estimates/${estimateId}/pdf?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (response.status === 401) {
      router.push('/auth/login')
      throw new Error('Unauthorized')
    }
    if (!response.ok) {
      throw new Error('Failed to generate PDF')
    }

    return response.text()
  }

  const fetchPdfBlob = async (): Promise<{ blob: Blob; filename: string }> => {
    const token = localStorage.getItem('accessToken')
    if (!token) {
      router.push('/auth/login')
      throw new Error('Not authenticated')
    }

    const response = await fetch(`/api/estimates/${estimateId}/pdf?download=1`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (response.status === 401) {
      router.push('/auth/login')
      throw new Error('Unauthorized')
    }
    if (!response.ok) {
      throw new Error('Failed to generate PDF')
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    const cd = response.headers.get('content-disposition') || ''
    const match = /filename=\"?([^\";]+)\"?/i.exec(cd)
    const headerFilename = match?.[1]?.trim()

    const blob = await response.blob()
    const fallbackExt = contentType.includes('pdf') ? 'pdf' : 'html'
    const fallbackFilename = `Estimate-${estimate?.estimateNumber || estimateId}.${fallbackExt}`

    return {
      blob,
      filename: headerFilename || fallbackFilename,
    }
  }

  const handleDownloadPDF = async () => {
    try {
      const { blob, filename } = await fetchPdfBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download estimate PDF error:', error)
      alert('Failed to download estimate PDF')
    }
  }

  const handlePrint = async () => {
    try {
      const html = await fetchPdfHtml(true)
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        alert('Popup blocked. Please allow popups to print.')
        return
      }
      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()
    } catch (error) {
      console.error('Print estimate PDF error:', error)
      alert('Failed to print estimate')
    }
  }

  const handleDuplicate = async () => {
    setDuplicating(true)
    try {
      const token = localStorage.getItem('accessToken')
      const response = await fetch(`/api/estimates/${estimateId}/duplicate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(data.error || 'Failed to duplicate estimate')
        return
      }

      if (data?.id) {
        router.push(`/dashboard/estimates/${data.id}`)
      } else {
        router.push('/dashboard/estimates')
      }
    } catch (error) {
      console.error('Duplicate estimate error:', error)
      alert('Failed to duplicate estimate')
    } finally {
      setDuplicating(false)
    }
  }

  const handleReimportLines = async () => {
    if (!confirm('Re-import line items from QuickBooks? This will replace all current line items with the latest structure from QBO (including subtotal rows). This cannot be undone.')) return
    setReimportingLines(true)
    try {
      const token = localStorage.getItem('accessToken')
      const res = await fetch(`/api/estimates/${estimateId}/reimport-lines`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || 'Failed to re-import line items.')
        return
      }
      alert(`Done! Replaced with ${data.regularItemCount} item(s) and ${data.subtotalRowsAdded} subtotal row(s) from QuickBooks.`)
      await fetchEstimate()
    } catch (e) {
      console.error('Reimport lines error:', e)
      alert('Failed to re-import line items.')
    } finally {
      setReimportingLines(false)
    }
  }

  const handleOpenConvertToInvoice = () => {
    if (!estimate) return
    // Bring back the progress billing modal; invoice is only created after the user saves the draft.
    setBillingMode('FULL')
    setBillingPercent('50')
    setSelectedLineItemIds(estimate.lineItems.map((li) => li.id))
    setShowBillingModal(true)
  }

  const handleConvertToInvoice = async () => {
    if (!estimate) return
    try {
      setConvertingInvoice(true)

      const mode = billingMode || 'FULL'
      if (mode === 'PERCENTAGE') {
        const pct = Number(billingPercent || 0)
        if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
          alert('Percentage must be between 0 and 100.')
          return
        }
      }
      if (mode === 'MANUAL' && selectedLineItemIds.length === 0) {
        alert('Select at least one line item to bill.')
        return
      }

      // Business rule: do NOT create/convert immediately. Open a draft invoice prefilled from this estimate.
      const qs = new URLSearchParams()
      qs.set('estimateId', estimate.id)
      qs.set('billingMode', mode)
      if (mode === 'PERCENTAGE') {
        qs.set('percentage', String(Number(billingPercent || 0)))
      }
      if (mode === 'MANUAL') {
        qs.set('selectedLineItemIds', selectedLineItemIds.join(','))
      }

      setShowBillingModal(false)
      router.push(`/dashboard/invoices/new?${qs.toString()}`)
    } catch (error) {
      console.error('Open invoice draft error:', error)
      alert('Failed to open invoice draft')
    } finally {
      setConvertingInvoice(false)
    }
  }

  const handleSendEstimate = async () => {
    if (!estimate || sending) return
    const emailsOnFile = Array.from(
      new Set(
        [
          ...splitEmailList(estimate.client?.email || ''),
          ...(estimate.client?.contacts || []).map((c) => c.email || ''),
        ]
          .map((v) => String(v || '').trim())
          .filter(Boolean)
      )
    )

    // If there are multiple emails on file, default to sending to all of them.
    const defaultEmail = emailsOnFile.length > 1 ? emailsOnFile.join(', ') : emailsOnFile[0] || ''
    setSendTo(defaultEmail)
    setSendToPreset(emailsOnFile.length === 1 ? emailsOnFile[0] : 'custom')
    setSendSubject(`Estimate ${estimate.estimateNumber}`)
    setSendMessage(`Please review estimate ${estimate.estimateNumber}.`)
    setShowSendModal(true)
    return
  }

  const submitSendEstimate = async () => {
    if (!estimate || sending) return
    const raw = String(sendTo || '').trim()
    if (!raw) return
    const emails = raw
      .split(/[,\s;]+/g)
      .map((v) => v.trim())
      .filter(Boolean)
    if (emails.length === 0) return

    setSending(true)
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        router.push('/auth/login')
        return
      }

      const response = await fetch(`/api/estimates/${estimateId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          emails,
          subject: sendSubject || `Estimate ${estimate.estimateNumber}`,
          message: sendMessage || `Please review estimate ${estimate.estimateNumber}.`,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(data.error || 'Failed to send estimate email')
        return
      }

      if (Array.isArray(data?.failedRecipients) && data.failedRecipients.length) {
        const failed = data.failedRecipients.map((r: any) => r.recipient || '').filter(Boolean).join(', ')
        alert(`Estimate sent, but failed for: ${failed}`)
      } else {
        alert('Estimate email sent successfully')
      }
      await fetchEstimate()
    } catch (error) {
      console.error('Send estimate error:', error)
      alert('Failed to send estimate email')
    } finally {
      setSending(false)
      setShowSendModal(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading estimate...</p>
        </div>
      </div>
    )
  }

  if (!estimate) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 text-xl font-semibold mb-2">Estimate not found</div>
        <p className="text-gray-600 mb-4">The estimate you're looking for doesn't exist or you don't have permission to view it.</p>
        <Button variant="outline" onClick={() => router.push('/dashboard/estimates')}>
          ← Back to Estimates
        </Button>
      </div>
    )
  }

  const primaryContact = estimate.client?.contacts?.[0] || null
  const optionalItems = (estimate as any).optionalItems || []
  const optionalItemsSubtotal = Array.isArray(optionalItems)
    ? optionalItems.reduce((sum: number, item: any) => sum + parseFloat(item.total || '0'), 0)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/dashboard/estimates">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{estimate.title}</h1>
            <p className="mt-1 text-gray-600">
              {estimate.estimateNumber}{' \u2022 '}Created {formatDate(estimate.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className={`px-3 py-1 text-sm rounded-full ${statusColors[estimate.status] || 'bg-gray-100 text-gray-800'}`}>
            {estimate.status === 'CONVERTED' && estimate.convertedPercent
              ? `CONVERTED (${estimate.convertedPercent}%)`
              : estimate.status}
          </span>
          <Button
            variant="outline"
            onClick={() => {
              const clientId = estimate?.client?.id || null
              router.push(
                `/dashboard/estimates/new${buildCreateContextQuery({
                  clientId,
                  sourceType: 'estimate',
                  sourceId: estimateId,
                })}`
              )
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Estimate
          </Button>
          <Button variant="outline" onClick={handleDownloadPDF}>
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" onClick={handleDuplicate} disabled={duplicating}>
            <Copy className="mr-2 h-4 w-4" />
            {duplicating ? 'Duplicating...' : 'Duplicate'}
          </Button>
          {estimate?.estimateNumber?.startsWith('QB-EST-') && (
            <Button
              variant="outline"
              onClick={handleReimportLines}
              disabled={reimportingLines}
              title="Re-fetch line items from QuickBooks (adds subtotal rows)"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${reimportingLines ? 'animate-spin' : ''}`} />
              {reimportingLines ? 'Re-importing...' : 'Sync Lines from QBO'}
            </Button>
          )}
          <Button variant="outline" onClick={handleOpenConvertToInvoice}>
            <DollarSign className="mr-2 h-4 w-4" />
            Convert to Invoice
          </Button>
          <Button variant="outline" onClick={() => router.push(`/dashboard/estimates/${estimateId}/edit`)}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button onClick={handleSendEstimate} disabled={sending}>
            <Send className="mr-2 h-4 w-4" />
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </div>

      <Dialog open={showSendModal} onOpenChange={setShowSendModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Estimate</DialogTitle>
            <DialogDescription>
              Select an email on file or enter one or more recipients (comma-separated).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(() => {
              const emailsOnFile = Array.from(
                new Set(
                  [
                    ...splitEmailList(estimate.client?.email || ''),
                    ...(estimate.client?.contacts || []).map((c) => c.email || ''),
                  ]
                    .map((v) => String(v || '').trim())
                    .filter(Boolean)
                )
              )
              if (emailsOnFile.length <= 1) return null
              return (
                <div className="space-y-2">
                  <Label>Choose email</Label>
                  <Select
                    value={sendToPreset}
                    onValueChange={(v) => {
                      setSendToPreset(v)
                      if (v !== 'custom') setSendTo(v)
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select email" />
                    </SelectTrigger>
                    <SelectContent>
                      {emailsOnFile.map((e) => (
                        <SelectItem key={e} value={e}>
                          {e}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )
            })()}

            <div className="space-y-2">
              <Label>To</Label>
              <Input
                value={sendTo}
                onChange={(e) => {
                  setSendTo(e.target.value)
                  setSendToPreset('custom')
                }}
                placeholder="client@email.com"
              />
              <p className="text-xs text-muted-foreground">You can enter multiple emails separated by commas.</p>
            </div>

            <div className="space-y-2">
              <Label>Subject</Label>
              <Input value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Message</Label>
              <Input value={sendMessage} onChange={(e) => setSendMessage(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendModal(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={() => submitSendEstimate()} disabled={sending || !sendTo.trim()}>
              {sending ? 'Sending...' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-4 font-semibold">Item</th>
                      <th className="text-left py-2 px-4 font-semibold">Description</th>
                      <th className="text-right py-2 px-4 font-semibold">Quantity</th>
                      <th className="text-right py-2 px-4 font-semibold">Unit Price</th>
                      <th className="text-right py-2 px-4 font-semibold">Vendor Cost</th>
                      <th className="text-right py-2 px-4 font-semibold">Margin</th>
                      <th className="text-right py-2 px-4 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Group line items by groupId
                      const groupedItems = new Map<string, typeof estimate.lineItems>()
                      const ungroupedItems: typeof estimate.lineItems = []

                      for (const item of estimate.lineItems) {
                        if (item.groupId && item.group) {
                          if (!groupedItems.has(item.groupId)) {
                            groupedItems.set(item.groupId, [])
                          }
                          groupedItems.get(item.groupId)!.push(item)
                        } else {
                          ungroupedItems.push(item)
                        }
                      }

                      const rows: JSX.Element[] = []

                      // Render grouped items
                      for (const [groupId, items] of groupedItems.entries()) {
                        const group = items[0].group!
                        const groupTotal = items.reduce((sum, item) => sum + parseFloat(item.total), 0)
                        const isExpanded = expandedGroups.has(groupId)

                        rows.push(
                          <tr key={`group-${groupId}`} className="border-b bg-gray-50">
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-between">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newExpanded = new Set(expandedGroups)
                                    if (isExpanded) {
                                      newExpanded.delete(groupId)
                                    } else {
                                      newExpanded.add(groupId)
                                    }
                                    setExpandedGroups(newExpanded)
                                  }}
                                  className="flex items-center space-x-2 hover:text-primary"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                  <Package className="h-4 w-4" />
                                  <span className="font-semibold">{group.name}</span>
                                  <span className="text-xs text-gray-500">(Bundle)</span>
                                </button>
                                <div className="flex items-center space-x-1">
                                  {group.sourceBundleId && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleUpdateFromTemplate(groupId)}
                                      disabled={processingGroup === groupId}
                                      title="Update from template"
                                    >
                                      <RefreshCw className={`h-3 w-3 ${processingGroup === groupId ? 'animate-spin' : ''}`} />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleUngroup(groupId)}
                                    disabled={processingGroup === groupId}
                                    title="Ungroup items"
                                  >
                                    <Unlink className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteGroup(groupId)}
                                    disabled={processingGroup === groupId}
                                    title="Delete group"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4"></td>
                            <td className="py-3 px-4 text-right"></td>
                            <td className="py-3 px-4 text-right"></td>
                            <td className="py-3 px-4 text-right"></td>
                            <td className="py-3 px-4 text-right"></td>
                            <td className="py-3 px-4 text-right font-semibold">
                              {formatCurrency(groupTotal)}
                            </td>
                          </tr>
                        )

                        if (isExpanded) {
                          items.forEach((item) => {
                            const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0
                            const unitPrice = parseFloat(item.unitPrice)
                            const qty = parseFloat(item.quantity)
                            const marginTotal = (unitPrice - unitCost) * qty
                            const isVisibleToClient = item.isVisibleToClient ?? true
                            rows.push(
                              <tr
                                key={item.id}
                                className={`border-b bg-gray-50/50 ${!isVisibleToClient ? 'opacity-70' : ''}`}
                              >
                                <td className="py-3 px-4 pl-8">
                                  {item.description}
                                  {!isVisibleToClient && (
                                    <span className="ml-2 text-xs text-gray-500">(Hidden from client)</span>
                                  )}
                                </td>
                                <td className="py-3 px-4">{item.notes || '-'}</td>
                                <td className="py-3 px-4 text-right">{item.quantity}</td>
                                <td className="py-3 px-4 text-right">{formatCurrency(unitPrice)}</td>
                                <td className="py-3 px-4 text-right">{formatCurrency(unitCost)}</td>
                                <td className="py-3 px-4 text-right">{formatCurrency(marginTotal)}</td>
                                <td className="py-3 px-4 text-right">
                                  {formatCurrency(parseFloat(item.total))}
                                </td>
                              </tr>
                            )
                          })
                          // Add "Add Item" row
                          rows.push(
                            <tr key={`add-item-${groupId}`} className="border-b bg-gray-50/50">
                              <td colSpan={7} className="py-2 px-4 pl-8">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleAddItemToGroup(groupId)}
                                  disabled={addingToGroup === groupId}
                                  className="text-xs"
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  {addingToGroup === groupId ? 'Adding...' : 'Add Item to Bundle'}
                                </Button>
                              </td>
                            </tr>
                          )
                        }
                      }

                      // Render ungrouped items (with subtotal rows)
                      ungroupedItems.forEach((item) => {
                        if (item.isSubtotal) {
                          rows.push(
                            <tr key={item.id} className="border-b bg-slate-50">
                              <td colSpan={6} className="py-2 px-4 text-right text-sm font-semibold text-slate-700">
                                Subtotal
                              </td>
                              <td className="py-2 px-4 text-right font-bold text-slate-800">
                                {formatCurrency(parseFloat(item.total || '0'))}
                              </td>
                            </tr>
                          )
                          return
                        }
                        const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0
                        const unitPrice = parseFloat(item.unitPrice)
                        const qty = parseFloat(item.quantity)
                        const marginTotal = (unitPrice - unitCost) * qty
                        const isVisibleToClient = item.isVisibleToClient ?? true
                        rows.push(
                          <tr key={item.id} className={`border-b ${!isVisibleToClient ? 'bg-gray-50' : ''}`}>
                            <td className="py-3 px-4">
                              {item.description}
                              {!isVisibleToClient && (
                                <span className="ml-2 text-xs text-gray-500">(Hidden from client)</span>
                              )}
                            </td>
                            <td className="py-3 px-4">{item.notes || '-'}</td>
                            <td className="py-3 px-4 text-right">{item.quantity}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(unitPrice)}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(unitCost)}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(marginTotal)}</td>
                            <td className="py-3 px-4 text-right font-semibold">
                              {formatCurrency(parseFloat(item.total))}
                            </td>
                          </tr>
                        )
                      })

                      return rows
                    })()}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Optional Items */}
          {Array.isArray(optionalItems) && optionalItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Optional Items</CardTitle>
                <CardDescription>Optional items are not included in the estimate total unless added later.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-4 font-semibold">Item</th>
                        <th className="text-left py-2 px-4 font-semibold">Description</th>
                        <th className="text-right py-2 px-4 font-semibold">Quantity</th>
                        <th className="text-right py-2 px-4 font-semibold">Unit Price</th>
                        <th className="text-right py-2 px-4 font-semibold">Vendor Cost</th>
                        <th className="text-right py-2 px-4 font-semibold">Margin</th>
                        <th className="text-right py-2 px-4 font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optionalItems.map((item: any) => {
                        const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0
                        const unitPrice = parseFloat(item.unitPrice || '0')
                        const qty = parseFloat(item.quantity || '0')
                        const marginTotal = (unitPrice - unitCost) * qty
                        const isVisibleToClient = item.isVisibleToClient ?? true
                        return (
                          <tr key={item.id} className={`border-b ${!isVisibleToClient ? 'bg-gray-50' : ''}`}>
                            <td className="py-3 px-4">
                              {item.description}
                              {!isVisibleToClient && (
                                <span className="ml-2 text-xs text-gray-500">(Hidden from client)</span>
                              )}
                            </td>
                            <td className="py-3 px-4">{item.notes || '-'}</td>
                            <td className="py-3 px-4 text-right">{item.quantity}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(unitPrice)}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(unitCost)}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(marginTotal)}</td>
                            <td className="py-3 px-4 text-right font-semibold">
                              {formatCurrency(parseFloat(item.total || '0'))}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes & Terms */}
          {(estimate.notes || estimate.terms) && (
            <div className="grid gap-6 md:grid-cols-2">
              {estimate.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      Notes
                      {estimate.isNotesVisibleToClient === false && (
                        <span className="ml-2 text-xs text-gray-500">(Hidden from client)</span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-700 whitespace-pre-wrap">{estimate.notes}</p>
                  </CardContent>
                </Card>
              )}
              {estimate.terms && (
                <Card>
                  <CardHeader>
                    <CardTitle>Terms & Conditions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-700 whitespace-pre-wrap">{estimate.terms}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal:</span>
                <span className="font-semibold">{formatCurrency(parseFloat(estimate.subtotal))}</span>
              </div>
              {optionalItemsSubtotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Optional Items Subtotal:</span>
                  <span className="font-semibold">{formatCurrency(optionalItemsSubtotal)}</span>
                </div>
              )}
              {parseFloat(estimate.discount) > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Discount:</span>
                  <span>-{formatCurrency(parseFloat(estimate.discount))}</span>
                </div>
              )}
              {parseFloat(estimate.taxRate) > 0 && (
                <>
                  <div className="flex justify-between text-gray-600">
                    <span>Tax ({parseFloat(estimate.taxRate) * 100}%):</span>
                    <span>{formatCurrency(parseFloat(estimate.taxAmount))}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-lg font-bold border-t pt-3">
                <span>Total:</span>
                <span>{formatCurrency(parseFloat(estimate.total))}</span>
              </div>
            </CardContent>
          </Card>

          {/* Approvals */}
          <Card>
            <CardHeader>
              <CardTitle>Approvals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingApprovals && <div className="text-sm text-gray-600">Loading approval status...</div>}
              {!loadingApprovals && approvalInfo?.approveUrl && (
                <>
                  <div className="text-sm text-gray-700">
                    Public approval link (customer, no login):
                  </div>
                  <div className="flex gap-2">
                    <Input value={approvalInfo.approveUrl} readOnly />
                    <Button type="button" variant="outline" onClick={handleCopyApprovalLink}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleRegenerateApprovalLink}
                      disabled={regeneratingApprovalLink}
                    >
                      {regeneratingApprovalLink ? 'Regenerating...' : 'Regenerate Link'}
                    </Button>
                  </div>

                  <div className="text-sm text-gray-700">
                    Approved items: <strong>{(approvalInfo.approvals || []).length}</strong>
                  </div>
                  {(approvalInfo.approvals || []).slice(0, 6).map((a: any) => (
                    <div key={a.id} className="rounded border p-2 text-sm">
                      <div className="font-medium">{a.item?.description || a.estimateLineItemId}</div>
                      <div className="text-gray-600">
                        {a.approvedByName ? `Approved by ${a.approvedByName}` : 'Approved'}{' '}
                        {a.approvedAt ? `\u2022 ${new Date(a.approvedAt).toLocaleString()}` : ''}
                      </div>
                    </div>
                  ))}
                  {(approvalInfo.approvals || []).length > 6 && (
                    <div className="text-xs text-gray-500">
                      Showing 6 of {(approvalInfo.approvals || []).length} approved items.
                    </div>
                  )}

                  <div className="text-sm text-gray-700">
                    Invoiced from approvals: <strong>{(approvalInfo.invoiceHistory || []).length}</strong>
                  </div>
                  {(approvalInfo.invoiceHistory || []).slice(0, 6).map((h: any) => (
                    <div key={h.id} className="rounded border p-2 text-sm">
                      <div className="font-medium">
                        {h.invoice?.invoiceNumber || h.invoiceId}
                      </div>
                      <div className="text-gray-600">
                        {h.createdAt ? `Created ${new Date(h.createdAt).toLocaleString()}` : ''}
                      </div>
                    </div>
                  ))}
                </>
              )}
              {!loadingApprovals && !approvalInfo?.approveUrl && (
                <div className="text-sm text-gray-600">
                  Approval link will be generated when the estimate is sent (or when PDF is generated).
                </div>
              )}
            </CardContent>
          </Card>

          {/* Client Information */}
          {estimate.client && (
            <Card>
              <CardHeader>
                <CardTitle>Client</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Link href={`/dashboard/clients/${estimate.client.id}`} className="text-primary hover:underline">
                    <Building2 className="inline h-4 w-4 mr-2" />
                    {estimate.client.name}
                  </Link>
                  {estimate.client.companyName && (
                    <p className="text-sm text-gray-600 mt-1">{estimate.client.companyName}</p>
                  )}
                </div>
                {primaryContact && (
                  <div className="text-sm text-gray-600">
                    <User className="inline h-4 w-4 mr-2" />
                    {primaryContact.firstName} {primaryContact.lastName}
                    {primaryContact.email && (
                      <p className="mt-1">
                        <Mail className="inline h-3 w-3 mr-1" />
                        {primaryContact.email}
                      </p>
                    )}
                    {primaryContact.phone && (
                      <p>
                        <FileText className="inline h-3 w-3 mr-1" />
                        {primaryContact.phone}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Lead Information */}
          {estimate.lead && (
            <Card>
              <CardHeader>
                <CardTitle>Request</CardTitle>
              </CardHeader>
              <CardContent>
                <Link href={`/dashboard/requests/${estimate.lead.id}`} className="text-primary hover:underline">
                  {estimate.lead.firstName} {estimate.lead.lastName}
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Job Information */}
          {estimate.job && (
            <Card>
              <CardHeader>
                <CardTitle>Job</CardTitle>
              </CardHeader>
              <CardContent>
                <Link href={`/dashboard/jobs/${estimate.job.id}`} className="text-primary hover:underline">
                  {estimate.job.jobNumber} - {estimate.job.title}
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Created:</span>
                <span>{formatDate(estimate.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Last Updated:</span>
                <span>{formatDate(estimate.updatedAt)}</span>
              </div>
              {estimate.validUntil && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Valid Until:</span>
                  <span className={new Date(estimate.validUntil) < new Date() ? 'text-red-600 font-semibold' : ''}>
                    {formatDate(estimate.validUntil)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentAttachments entityType="estimate" entityId={estimateId} />
            </CardContent>
          </Card>

          {estimate.jobSiteAddress && (
            <Card>
              <CardHeader>
                <CardTitle>Job Site</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700">{estimate.jobSiteAddress}</p>
                <iframe
                  title="Estimate Job Site Map"
                  className="mt-3 h-48 w-full rounded-md border"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(estimate.jobSiteAddress)}&output=embed`}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Item Picker for adding items to groups */}
      {showItemPicker && (
        <ItemPicker
          onSelect={handleItemSelectForGroup}
          onClose={() => {
            setShowItemPicker(false)
            setItemPickerGroupId(null)
          }}
        />
      )}

      <Dialog open={showBillingModal} onOpenChange={setShowBillingModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Invoice from Estimate</DialogTitle>
            <DialogDescription>
              Choose how much to bill now. All currency calculations are handled precisely.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="bill-full"
                checked={billingMode === 'FULL'}
                onChange={() => setBillingMode('FULL')}
              />
              <Label htmlFor="bill-full">Full Amount (100%)</Label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="radio"
                id="bill-percentage"
                checked={billingMode === 'PERCENTAGE'}
                onChange={() => setBillingMode('PERCENTAGE')}
              />
              <Label htmlFor="bill-percentage">Percentage</Label>
              <Input
                className="w-28"
                type="number"
                min={1}
                max={100}
                step={0.01}
                value={billingPercent}
                onChange={(e) => setBillingPercent(e.target.value)}
                disabled={billingMode !== 'PERCENTAGE'}
              />
              <span className="text-sm text-gray-600">%</span>
              {billingMode === 'PERCENTAGE' && (() => {
                const pct = Number(billingPercent || 0)
                const estimateTotal = Number(estimate?.total || 0)
                if (pct > 0 && pct <= 100 && estimateTotal > 0) {
                  const invoiceAmt = (estimateTotal * pct / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                  return <span className="text-sm font-semibold text-green-700">&rarr; Invoice for {invoiceAmt}</span>
                }
                return null
              })()}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="bill-manual"
                checked={billingMode === 'MANUAL'}
                onChange={() => setBillingMode('MANUAL')}
              />
              <Label htmlFor="bill-manual">Manual Selection (Line Items)</Label>
            </div>

            {billingMode === 'MANUAL' && (
              <div className="max-h-64 space-y-2 overflow-auto rounded border p-3">
                {estimate?.lineItems.map((li) => (
                  <div key={li.id} className="flex items-center justify-between gap-3 rounded border p-2">
                    <div className="text-sm">
                      <div className="font-medium">{li.description}</div>
                      <div className="text-gray-500">
                        Qty {li.quantity}{' \u2022 '}${Number(li.unitPrice).toFixed(2)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">${Number(li.total).toFixed(2)}</span>
                      <Checkbox
                        checked={selectedLineItemIds.includes(li.id)}
                        onCheckedChange={(checked) => {
                          setSelectedLineItemIds((prev) =>
                            checked ? [...prev, li.id] : prev.filter((id) => id !== li.id)
                          )
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBillingModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleConvertToInvoice} disabled={convertingInvoice}>
              {convertingInvoice ? 'Creating...' : 'Create Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
