'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileText, Plus, Download, Calendar, Filter, Settings } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { ReportBuilder } from '@/components/reports/ReportBuilder'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface Report {
  id: string
  name: string
  description: string | null
  type: string
  createdAt: string
  updatedAt: string
  createdBy: string
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'templates' | 'custom' | 'scheduled'>('templates')
  const [showBuilder, setShowBuilder] = useState(false)
  const [configuringTemplate, setConfiguringTemplate] = useState<string | null>(null)

  useEffect(() => {
    fetchReports()
  }, [])

  const fetchReports = async () => {
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

  const templateReports = [
    { id: 'jobs-by-date', name: 'Jobs by Date', description: 'List all jobs within a date range', type: 'JOBS', dataset: 'jobs' },
    { id: 'revenue-by-month', name: 'Revenue by Month', description: 'Monthly revenue breakdown', type: 'REVENUE', dataset: 'invoices' },
    { id: 'invoices-aging', name: 'Invoices Aging', description: 'Outstanding invoices by age', type: 'INVOICES', dataset: 'invoices' },
    { id: 'leads-funnel', name: 'Requests Funnel', description: 'Request conversion funnel analysis', type: 'LEADS', dataset: 'leads' },
    { id: 'tech-performance', name: 'Tech Performance', description: 'Technician performance metrics', type: 'PERFORMANCE', dataset: 'jobs' },
    { id: 'dispatch-performance', name: 'Dispatch Performance', description: 'Dispatch efficiency metrics', type: 'DISPATCH', dataset: 'dispatch' },
  ]

  const handleDownloadTemplate = async (template: typeof templateReports[0]) => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        window.location.href = '/auth/login'
        return
      }

      // First, create a temporary report for the template
      const reportResponse = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: template.name,
          description: template.description,
          type: 'PREBUILT',
          template: template.id,
          dataset: template.dataset,
        }),
      })

      if (reportResponse.ok) {
        const { report } = await reportResponse.json()
        
        // Now run and download the report
        const runResponse = await fetch(`/api/reports/${report.id}/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ format: 'csv' }),
        })

        if (runResponse.ok) {
          const blob = await runResponse.blob()
          const downloadUrl = window.URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = downloadUrl
          link.download = `${template.id}-${new Date().toISOString().split('T')[0]}.csv`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          window.URL.revokeObjectURL(downloadUrl)
        } else {
          const error = await runResponse.json()
          alert(error.error || 'Failed to generate report')
        }
      } else {
        const error = await reportResponse.json()
        alert(error.error || 'Failed to create report')
      }
    } catch (error) {
      console.error('Failed to download template:', error)
      alert('Failed to download report')
    }
  }

  const handleConfigureTemplate = (templateId: string) => {
    setConfiguringTemplate(templateId)
    setShowBuilder(true)
  }

  const handleDownloadCustom = async (report: Report) => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        window.location.href = '/auth/login'
        return
      }

      const response = await fetch(`/api/reports/${report.id}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ format: 'csv' }),
      })

      if (response.ok) {
        const blob = await response.blob()
        const downloadUrl = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = downloadUrl
        link.download = `${report.name}-${new Date().toISOString().split('T')[0]}.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(downloadUrl)
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to generate report')
      }
    } catch (error) {
      console.error('Failed to download report:', error)
      alert('Failed to download report')
    }
  }

  const handleEditReport = (report: Report) => {
    // TODO: Open edit dialog with ReportBuilder pre-filled
    alert('Edit functionality coming soon!')
  }

  if (loading) {
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
              onRun={(report) => {
                // Handle running the report
                console.log('Run report:', report)
                alert('Report execution coming soon!')
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="templates">Report Templates</TabsTrigger>
          <TabsTrigger value="custom">Custom Reports</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled Reports</TabsTrigger>
        </TabsList>

        {/* Report Templates */}
        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pre-built Report Templates</CardTitle>
              <CardDescription>Quick access to common reports</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {templateReports.map((template) => (
                  <Card key={template.id} className="hover:border-blue-500 transition-colors cursor-pointer">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        {template.name}
                      </CardTitle>
                      <CardDescription>{template.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          onClick={() => handleConfigureTemplate(template.id)}
                        >
                          <Filter className="mr-2 h-4 w-4" />
                          Configure
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleDownloadTemplate(template)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Custom Reports */}
        <TabsContent value="custom" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Custom Reports</CardTitle>
              <CardDescription>Your saved custom report configurations</CardDescription>
            </CardHeader>
            <CardContent>
              {reports.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-600">No custom reports yet</p>
                  <p className="text-sm text-gray-500 mt-2">Create your first custom report to get started</p>
                  <Button 
                    className="mt-4"
                    onClick={() => setShowBuilder(true)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create Custom Report
                  </Button>
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
                          Created {formatDate(report.createdAt)} • Updated {formatDate(report.updatedAt)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleEditReport(report)}
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleDownloadCustom(report)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scheduled Reports */}
        <TabsContent value="scheduled" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Scheduled Reports</CardTitle>
              <CardDescription>Reports that run automatically on a schedule</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <Calendar className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600">No scheduled reports</p>
                <p className="text-sm text-gray-500 mt-2">Schedule reports to be emailed automatically</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
