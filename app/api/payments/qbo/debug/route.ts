import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  if (!['ADMIN', 'OFFICE', 'ACCOUNTING'].includes(String(user.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const webhookEvents = await prisma.webhookEvent.findMany({
    where: {
      tenantId: user.tenantId,
      provider: 'quickbooks',
    },
    orderBy: { receivedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      eventId: true,
      eventType: true,
      receivedAt: true,
      processedAt: true,
      processed: true,
      error: true,
      payloadHash: true,
    },
  })

  const payments = await prisma.payment.findMany({
    where: {
      invoice: { tenantId: user.tenantId },
      provider: 'quickbooks',
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      invoiceId: true,
      amount: true,
      status: true,
      providerPaymentId: true,
      providerInvoiceId: true,
      receiptEmailSentAt: true,
      receiptEmailAttempts: true,
      receiptEmailError: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ webhookEvents, payments })
}
