'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ResponsivePage } from '@/components/layout/ResponsivePage'
import { CompanyCustomerEstimateDemo } from '@/components/estimates/company-customer-estimate-demo'

/**
 * Dev/example page for dual company + customer estimates.
 * Open at /dashboard/estimates/company-customer-demo
 */
export default function CompanyCustomerEstimateDemoPage() {
  return (
    <ResponsivePage>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Company + Customer Estimate — Example
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dev preview: company side uses full estimate line fields; customer side shows Line #
            bundles. Save creates a real draft estimate, then opens the after-save view.
          </p>
        </div>
        <Link href="/dashboard/estimates">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to estimates
          </Button>
        </Link>
      </div>
      <CompanyCustomerEstimateDemo />
    </ResponsivePage>
  )
}
