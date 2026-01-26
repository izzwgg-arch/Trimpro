'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  ArrowLeft,
  Calendar,
  DollarSign,
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
} from 'lucide-react'
import Link from 'next/link'

interface EstimateDetail {
  id: string
  estimateNumber: string
  title: string
  status: string
  subtotal: string
  taxRate: string
  taxAmount: string
  discount: string
  total: string
  validUntil: string | null
  notes: string | null
  terms: string | null
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
    total: string
    sortOrder: number
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

  useEffect(() => {
    fetchEstimate()
  }, [estimateId])

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
              {estimate.estimateNumber} • Created {formatDate(estimate.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className={`px-3 py-1 text-sm rounded-full ${statusColors[estimate.status] || 'bg-gray-100 text-gray-800'}`}>
            {estimate.status}
          </span>
          <Button variant="outline">
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button>
            <Send className="mr-2 h-4 w-4" />
            Send
          </Button>
        </div>
      </div>

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
                      <th className="text-left py-2 px-4 font-semibold">Description</th>
                      <th className="text-right py-2 px-4 font-semibold">Quantity</th>
                      <th className="text-right py-2 px-4 font-semibold">Unit Price</th>
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
                            <td className="py-3 px-4 text-right"></td>
                            <td className="py-3 px-4 text-right"></td>
                            <td className="py-3 px-4 text-right font-semibold">
                              {formatCurrency(groupTotal)}
                            </td>
                          </tr>
                        )

                        if (isExpanded) {
                          items.forEach((item) => {
                            rows.push(
                              <tr key={item.id} className="border-b bg-gray-50/50">
                                <td className="py-3 px-4 pl-8">{item.description}</td>
                                <td className="py-3 px-4 text-right">{item.quantity}</td>
                                <td className="py-3 px-4 text-right">{formatCurrency(parseFloat(item.unitPrice))}</td>
                                <td className="py-3 px-4 text-right">
                                  {formatCurrency(parseFloat(item.total))}
                                </td>
                              </tr>
                            )
                          })
                        }
                      }

                      // Render ungrouped items
                      ungroupedItems.forEach((item) => {
                        rows.push(
                          <tr key={item.id} className="border-b">
                            <td className="py-3 px-4">{item.description}</td>
                            <td className="py-3 px-4 text-right">{item.quantity}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(parseFloat(item.unitPrice))}</td>
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

          {/* Notes & Terms */}
          {(estimate.notes || estimate.terms) && (
            <div className="grid gap-6 md:grid-cols-2">
              {estimate.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle>Notes</CardTitle>
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
        </div>
      </div>
    </div>
  )
}
