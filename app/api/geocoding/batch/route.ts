import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { batchGeocodeAddresses } from '@/lib/geocoding'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const { addressIds } = body

    if (!Array.isArray(addressIds) || addressIds.length === 0) {
      return NextResponse.json({ error: 'addressIds array is required' }, { status: 400 })
    }

    // Limit batch size for safety
    const limitedIds = addressIds.slice(0, 100)
    const successCount = await batchGeocodeAddresses(limitedIds, 200)

    return NextResponse.json({
      success: true,
      processed: limitedIds.length,
      successCount,
      failed: limitedIds.length - successCount,
    })
  } catch (error) {
    console.error('Batch geocoding error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
