import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { getClientCreditBalance, listActiveClientCredits } from '@/lib/payments/customer-credit'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.view')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const [balance, credits] = await Promise.all([
      getClientCreditBalance(params.id, user.tenantId),
      listActiveClientCredits(params.id, user.tenantId),
    ])
    return NextResponse.json({
      balance,
      credits: credits.map((c) => ({
        id: c.id,
        originalAmount: Number(c.originalAmount),
        remainingAmount: Number(c.remainingAmount),
        reason: c.reason,
        createdAt: c.createdAt,
        sourcePaymentGroupId: c.sourcePaymentGroupId,
      })),
    })
  } catch (error) {
    console.error('Get client credit error:', error)
    return NextResponse.json({ error: 'Failed to load client credit' }, { status: 500 })
  }
}
