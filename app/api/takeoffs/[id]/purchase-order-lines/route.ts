import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { hasPermission } from '@/lib/authorization'
import { buildPurchaseOrderLines } from '@/lib/takeoffs/model'
import { loadTakeoff, loadTakeoffConfig, requireTakeoffPermission, serializeTakeoff } from '@/lib/takeoffs/server'

// GET — the takeoff turned into purchase order lines, to prefill a new PO.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireTakeoffPermission(request, 'view')
  if (permError) return permError

  const user = getAuthUser(request)
  if (!(await hasPermission(user.id, user.tenantId, 'purchase_orders.create'))) {
    return NextResponse.json({ error: 'You do not have permission to create purchase orders' }, { status: 403 })
  }
  const { takeoff, error } = await loadTakeoff(user, params.id)
  if (error) return error

  const data = await serializeTakeoff(takeoff)
  const config = await loadTakeoffConfig(user.tenantId)
  return NextResponse.json({
    jobId: takeoff.jobId,
    takeoffTitle: data.title,
    jobNumber: data.job?.jobNumber || '',
    lines: buildPurchaseOrderLines(data, config),
  })
}
