'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ResponsivePage } from '@/components/layout/ResponsivePage'
import { EstimateMaterialList } from '@/components/estimates/estimate-material-list'

/**
 * Dev/example page for the Estimate Material List tab.
 * Open at /dashboard/estimates/material-list-demo while building the feature.
 */
export default function EstimateMaterialListDemoPage() {
  return (
    <ResponsivePage>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Material List — Example</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dev preview: collect and sort vendor prices for estimate materials. Not linked to QuickBooks.
          </p>
        </div>
        <Link href="/dashboard/estimates">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to estimates
          </Button>
        </Link>
      </div>
      <EstimateMaterialList demoMode />
    </ResponsivePage>
  )
}
