import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import {
  getProductionConfigForTenant,
  saveProductionConfigForTenant,
  resetProductionConfigForTenant,
} from '@/lib/production/settings'
import { mergeProductionConfig } from '@/lib/production/config'

// Read the effective config. Gated by production.view so the board (and the
// settings page) can both read it.
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'production.view')
  if (permError) return permError

  const user = getAuthUser(request)
  const config = await getProductionConfigForTenant(user.tenantId)
  return NextResponse.json(
    { config },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}

// Save customization. Gated by production.manage (display only — never touches
// Job Status).
export async function PUT(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'production.manage')
  if (permError) return permError

  const user = getAuthUser(request)
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid config payload' }, { status: 400 })
    }
    // mergeProductionConfig normalizes/sanitizes against the current JobStatus
    // enum and fills any missing fields, so arbitrary input can't corrupt it.
    const normalized = mergeProductionConfig(body.config ?? body)
    const config = await saveProductionConfigForTenant(user.tenantId, normalized)
    return NextResponse.json({ config })
  } catch (error) {
    console.error('Save production settings error:', error)
    return NextResponse.json({ error: 'Failed to save production settings' }, { status: 500 })
  }
}

// Reset to the derived defaults.
export async function DELETE(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'production.manage')
  if (permError) return permError

  const user = getAuthUser(request)
  try {
    const config = await resetProductionConfigForTenant(user.tenantId)
    return NextResponse.json({ config })
  } catch (error) {
    console.error('Reset production settings error:', error)
    return NextResponse.json({ error: 'Failed to reset production settings' }, { status: 500 })
  }
}
