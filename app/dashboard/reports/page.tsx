'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileText, Plus, Download, Eye, Printer, Users, TrendingUp, Briefcase, Truck, Clock } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { ReportBuilder } from '@/components/reports/ReportBuilder'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { usePermissions, hasPermission } from '@/hooks/usePermissions'

interface Report {
  id: string
  name: string
  description: string | null
  type: string
  createdAt: string
  updatedAt: string
  createdBy: string
}

const FINANCIAL_REPORTS = [
  {
    href: '/dashboard/reports/revenue',
    name: 'Revenue by Month',
    description: 'Invoiced vs. collected revenue, compared to the prior period',
    icon: TrendingUp,
  },
  {
    href: '/dashboard/reports/aging',
    name: 'Invoices Aging',
    description: 'Outstanding balances by how overdue they are',
    icon: Clock,
  },
  {
    href: '/dashboard/reports/customer-statement',
    name: 'Customer Statement',
    description: 'Invoices, payments applied, and running balance for a customer',
    icon: Users,
  },
  {
    href: '/dashboard/reports/job-profitability',
    name: 'Job Profitability',
    description: 'Revenue vs. labor and material cost per job',
    icon: Briefcase,
  },
  {
    href: '/dashboard/reports/vendor-spend',
    name: 'Vendor Spend',
    description: 'Purchase order spend by vendor',
    icon: Truck,
  },
]

export default function ReportsPage() {
  const { permissions, loading: permissionsLoading } = usePermissions()
  const canViewReports = hasPermission(permissions, 'reports.view')
  const canCreateReports = hasPermission(permissions, 'reports.create')
  const canViewPayments = hasPermission(permissions, 'payments.view')
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [showBuilder, setShowBuilder] = useState(false)

  useEffect(() => {
    if (permissionsLoading) return
    fetchReports()
  }, [permissionsLoading, canViewReports])

  const fetchReports = async () => {
    if (!canViewReports) {
      setReports([])
      setLoading(false)
      return
    }

    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        window.location.href = '/auth/login'
        return
      }

      const response = await fetch('/api/reports', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        setReports(data.reports || [])
      }
    } catch (error) {
      console.error('Failed to fetch reports:', error)
    } finally {
      setLoading(false)
    }
  }

  const openPdfBlob = (blob: Blob, mode: 'view' | 'print' | 'download', filename: string) => {
    const pdfUrl = window.URL.createObjectURL(blob)
    if (mode === 'download') {
      const link = document.createElement('a')
      link.href = pdfUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => window.URL.revokeObjectURL(pdfUrl), 1000)
      return
    }

    const win = window.open(pdfUrl, '_blank')
    if (!win) {
      alert('Popup blocked. Please allow popups for this site.')
      return
    }
    if (mode === 'print') {
      setTimeout(() => {
        try {
          win.focus()
          win.print()
        } catch {}
      }, 800)
    }
  }

  const runReportPdf = async (reportId: string) => {
    const token = localStorage.getItem('accessToken')
    const response = await fetch(`/api/reports/${reportId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ format: 'pdf' }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to generate report PDF' }))
      throw new Error(error.error || 'Failed to generate report PDF')
    }
    return response.blob()
  }

  const handleCustomAction = async (report: Report, mode: 'view' | 'print' | 'download') => {
    try {
      const blob = await runReportPdf(report.id)
      openPdfBlob(blob, mode, `${report.name}-${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (error) {
      console.error('Failed to run report:', error)
      alert('Failed to generate report PDF')
    }
  }

  // Builder's "Run" gives an unsaved config — save it (there's no run-without-saving
  // endpoint) then immediately run and open the PDF. It'll also show up in the
  // Custom Reports list below, same as clicking "Create Custom Report" would.
  const handleBuilderRun = async (reportConfig: any) => {
    const token = localStorage.getItem('accessToken')
    try {
      const createResponse = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(reportConfig),
      })
      if (!createResponse.ok) {
        const error = await createResponse.json().catch(() => ({}))
        alert(error.error || 'Failed to run report')
        return
      }
      const { report } = await createResponse.json()
      setReports((prev) => [report, ...prev])
      const blob = await runReportPdf(report.id)
      openPdfBlob(blob, 'view', `${reportConfig.name || 'report'}.pdf`)
    } catch (error) {
      console.error('Failed to run report from builder:', error)
      alert('Failed to run report')
    }
  }

  if (loading || permissionsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading reports...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-600 mt-1">Generate and manage reports</p>
        </div>
        <div className="flex items-center gap-2">
          {canViewPayments && (
            <Link href="/dashboard/reports/payments">
              <Button variant="outline">Payment History</Button>
            </Link>
          )}
          {canCreateReports && (
            <Dialog open={showBuilder} onOpenChange={setShowBuilder}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Custom Report
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Report Builder</DialogTitle>
                  <DialogDescription>Create a custom report by selecting dataset, columns, filters, and sorting</DialogDescription>
                </DialogHeader>
                <ReportBuilder
                  onSave={(report) => {
                    setReports([report, ...reports])
                    setShowBuilder(false)
                    fetchReports()
                  }}
                  onRun={handleBuilderRun}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {!canViewReports && canViewPayments && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-600">
            You have access to Payment History only. Use the button above to open payments.
          </CardContent>
        </Card>
      )}

      {canViewReports && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Financial Reports</CardTitle>
              <CardDescription>Ready-to-run reports with charts, totals, and PDF/CSV export</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {FINANCIAL_REPORTS.map((report) => (
                  <Link key={report.href} href={report.href}>
                    <Card className="h-full hover:border-blue-500 hover:shadow-sm transition-all cursor-pointer">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <report.icon className="h-5 w-5 text-blue-600" />
                          {report.name}
                        </CardTitle>
                        <CardDescription>{report.description}</CardDescription>
                      </CardHeader>
                    </Card>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Custom Reports</CardTitle>
              <CardDescription>Build your own report from Jobs, Invoices, Requests, or Clients data</CardDescription>
            </CardHeader>
            <CardContent>
              {reports.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-600">No custom reports yet</p>
                  <p className="text-sm text-gray-500 mt-2">Create your first custom report to get started</p>
                  {canCreateReports && (
                    <Button className="mt-4" onClick={() => setShowBuilder(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Custom Report
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {reports.map((report) => (
                    <div
                      key={report.id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-blue-500 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <FileText className="h-5 w-5 text-gray-400" />
                          <h3 className="font-medium">{report.name}</h3>
                          <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-600">
                            {report.type}
                          </span>
                        </div>
                        {report.description && (
                          <p className="text-sm text-gray-600 mt-1">{report.description}</p>
                        )}
                        <p className="text-xs text-gray-500 mt-2">
                          Created {formatDate(report.createdAt)}{' • '}Updated {formatDate(report.updatedAt)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleCustomAction(report, 'view')}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleCustomAction(report, 'download')}>
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleCustomAction(report, 'print')}>
                          <Printer className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
