import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { importQuickBooksEstimateById } from '@/lib/services/qbo-sync'

function toClientError(message: string) {
  const normalized = String(message || '')
  const lower = normalized.toLowerCase()

  if (lower.includes('must be a numeric value')) {
    return { status: 400, error: 'QuickBooks estimate ID must be a number (e.g. 1482).' }
  }

  // QBO error code 610 — estimate was deleted or made inactive in QuickBooks
  if (lower.includes('made inactive') || lower.includes('code=610')) {
    return {
      status: 404,
      error:
        'This QuickBooks estimate has been deleted or made inactive in QuickBooks. Only active estimates can be imported.',
    }
  }

  if (
    lower.includes('not found') ||
    lower.includes('status=404') ||
    lower.includes('object not found')
  ) {
    return { status: 404, error: 'QuickBooks estimate not found. Double-check the ID.' }
  }

  if (lower.includes('not connected') || lower.includes('refresh token') || lower.includes('access token')) {
    return { status: 503, error: normalized || 'QuickBooks connection is unavailable.' }
  }

  if (lower.includes('invalid') && !lower.includes('validationfault') && !lower.includes('inactive')) {
    return { status: 400, error: normalized || 'Invalid QuickBooks estimate ID.' }
  }

  return { status: 500, error: normalized || 'Estimate import failed.' }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json().catch(() => ({}))
    const qboEstimateId = String(body?.qboEstimateId || '').trim()

    if (!qboEstimateId) {
      return NextResponse.json({ error: 'QuickBooks estimate ID is required.' }, { status: 400 })
    }

    const result = await importQuickBooksEstimateById(user.tenantId, qboEstimateId)

    if (result.alreadyImported) {
      return NextResponse.json(
        {
          success: false,
          alreadyImported: true,
          error: 'This QuickBooks estimate has already been imported.',
          estimate: result.estimate,
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      alreadyImported: false,
      estimate: result.estimate,
      placeholderClientCreated: result.placeholderClientCreated,
      placeholderClient: result.placeholderClient,
    })
  } catch (error: any) {
    console.error('QuickBooks estimate import by ID error:', error)
    const mapped = toClientError(error?.message || 'Estimate import failed.')
    return NextResponse.json({ error: mapped.error }, { status: mapped.status })
  }
}
