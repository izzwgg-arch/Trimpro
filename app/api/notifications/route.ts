import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { reconcileTenantRecentAchPayments } from '@/lib/qbo/reconcile-ach'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const status = searchParams.get('status') // 'UNREAD' | 'READ' | null for all

  try {
    // Fallback for missed Intuit webhooks: reconcile recent ACH intents before returning notifications.
    // This makes dashboard popup + notification + receipt email appear even when webhook/redirect is missed.
    if (['ADMIN', 'OFFICE', 'ACCOUNTING'].includes(String(user.role))) {
      try {
        await reconcileTenantRecentAchPayments(user.tenantId)
      } catch (e) {
        console.error('[QBO ACH] Notification-route reconcile failed:', e)
      }
    }

    const where: any = {
      tenantId: user.tenantId,
      userId: user.id,
    }

    if (status) {
      where.status = status
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    })

    return NextResponse.json({ notifications })
  } catch (error) {
    console.error('Get notifications error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
