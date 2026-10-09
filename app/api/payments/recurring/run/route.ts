import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { processDueRecurringPayments } from '@/lib/payments/recurring'

export const runtime = 'nodejs'
// Allow the whole batch to run (card charges are sequential).
export const maxDuration = 300

/**
 * Scheduler entrypoint: charge every recurring card payment that is due.
 * Called by the server's cron with the shared CRON_SECRET, or manually by a
 * staff member with payments.manage (processes only their tenant's due items —
 * the engine still scopes each charge to its own tenant).
 */
async function authorize(request: NextRequest): Promise<true | NextResponse> {
  const cronSecret = String(process.env.CRON_SECRET || '').trim()
  const provided = String(
    request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  ).trim()
  if (cronSecret && provided && cronSecret === provided) return true

  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.manage')
  if (permError) return permError
  return true
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request)
  if (auth !== true) return auth

  try {
    const summary = await processDueRecurringPayments()
    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    console.error('Recurring payments run error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Convenience for cron services that only issue GETs.
export async function GET(request: NextRequest) {
  return POST(request)
}
