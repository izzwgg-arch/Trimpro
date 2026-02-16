import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { importQuickBooksCustomersAndPayments } from '@/lib/services/qbo-sync'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  try {
    const body = await request.json().catch(() => ({}))
    const includePayments = Boolean(body?.includePayments)
    const result = await importQuickBooksCustomersAndPayments(user.tenantId, { includePayments })
    return NextResponse.json({
      success: true,
      mode: includePayments ? 'customers_and_payments' : 'customers_only',
      ...result,
    })
  } catch (error: any) {
    console.error('QBO historical import error:', error)
    return NextResponse.json(
      { error: error?.message || 'Historical import failed' },
      { status: 500 }
    )
  }
}

