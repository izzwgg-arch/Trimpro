import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import {
  syncClientToQuickBooks,
  syncEstimateToQuickBooks,
  syncInvoiceToQuickBooks,
  syncJobToQuickBooksProject,
  syncLeadToQuickBooksProject,
  syncPaymentToQuickBooks,
} from '@/lib/services/qbo-sync'

type TriggerEvent =
  | 'client.created'
  | 'request.created'
  | 'job.created'
  | 'estimate.created'
  | 'invoice.created'
  | 'payment.recorded'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  try {
    const body = await request.json().catch(() => ({}))
    const event = String(body?.event || '') as TriggerEvent
    const entityId = String(body?.entityId || '')
    if (!event || !entityId) {
      return NextResponse.json({ error: 'event and entityId are required' }, { status: 400 })
    }

    switch (event) {
      case 'client.created':
        await syncClientToQuickBooks(user.tenantId, entityId)
        break
      case 'request.created':
        await syncLeadToQuickBooksProject(user.tenantId, entityId)
        break
      case 'job.created':
        await syncJobToQuickBooksProject(user.tenantId, entityId)
        break
      case 'estimate.created':
        await syncEstimateToQuickBooks(user.tenantId, entityId)
        break
      case 'invoice.created':
        await syncInvoiceToQuickBooks(user.tenantId, entityId)
        break
      case 'payment.recorded':
        await syncPaymentToQuickBooks(user.tenantId, entityId)
        break
      default:
        return NextResponse.json({ error: 'Unsupported event type' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('QBO trigger sync error:', error)
    return NextResponse.json({ error: error?.message || 'Trigger sync failed' }, { status: 500 })
  }
}

