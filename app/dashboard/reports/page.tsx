'use client'

import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Users, TrendingUp, Briefcase, Truck, Clock } from 'lucide-react'
import { usePermissions, hasPermission } from '@/hooks/usePermissions'

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
  const canViewPayments = hasPermission(permissions, 'payments.view')

  if (permissionsLoading) {
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-600 mt-1">Generate and manage reports</p>
        </div>
        {canViewPayments && (
          <Link href="/dashboard/reports/payments">
            <Button variant="outline">Payment History</Button>
          </Link>
        )}
      </div>

      {!canViewReports && canViewPayments && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-600">
            You have access to Payment History only. Use the button above to open payments.
          </CardContent>
        </Card>
      )}

      {canViewReports && (
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
      )}
    </div>
  )
}
