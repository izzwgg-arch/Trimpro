import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { allocateNextEstimateNumber } from '@/lib/qbo/doc-numbers'

/**
 * Returns the next estimate number that would be used if the client leaves
 * "Estimate #" blank on create. Local TrimPro only (no QuickBooks API).
 * QBO DocNumber is checked once on POST /api/estimates at save time.
 */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const estimateNumber = await allocateNextEstimateNumber({ tenantId: user.tenantId })
    return NextResponse.json({ estimateNumber })
  } catch (error: any) {
    console.error('GET /api/estimates/next-number:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to determine next estimate number' },
      { status: 500 }
    )
  }
}
