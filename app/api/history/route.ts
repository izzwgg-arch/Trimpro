import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { getEntityHistory, historyPermissionFor } from '@/lib/history/entity-history'

/**
 * Unified, readable history timeline for a single record (document, customer,
 * vendor, job, file, …). Merges the Activity feed + AuditLog for that entity.
 * Read-only. Gated by the viewing permission of the entity in question.
 */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const entityType = searchParams.get('entityType') || ''
  const entityId = searchParams.get('entityId') || ''
  const limit = Math.min(300, Math.max(1, Number(searchParams.get('limit')) || 100))

  if (!entityType || !entityId) {
    return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 })
  }

  // Require the entity's own view permission when we know it.
  const perm = historyPermissionFor(entityType)
  if (perm) {
    const permError = await requirePermission(request, perm)
    if (permError) return permError
  }

  const user = getAuthUser(request)
  try {
    const items = await getEntityHistory({ tenantId: user.tenantId, entityType, entityId, limit })
    return NextResponse.json(
      { items },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('Entity history error:', error)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }
}
