import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { allocateNextPurchaseOrderNumber } from '@/lib/qbo/doc-numbers'

/**
 * Returns the next PO number that would be used if the client leaves
 * "PO #" blank on create. Local TrimPro only.
 */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'purchase_orders.view')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const poNumber = await allocateNextPurchaseOrderNumber({ tenantId: user.tenantId })
    return NextResponse.json({ poNumber })
  } catch (error: any) {
    console.error('GET /api/purchase-orders/next-number:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to determine next purchase order number' },
      { status: 500 }
    )
  }
}
