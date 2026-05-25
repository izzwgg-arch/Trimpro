import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { hasAnyPermission } from '@/lib/authorization'
import { isValidEmail } from '@/lib/email'
import {
  generatePaymentReceiptPdf,
  sendPaymentReceiptForPayment,
} from '@/lib/payments/receipts'

async function assertReceiptAccess(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return { error: authError }

  const user = getAuthUser(request)
  const hasAccess =
    user.role === 'ADMIN' ||
    (await hasAnyPermission(user.id, user.tenantId, [
      'clients.view',
      'invoices.view',
      'invoices.send',
      'payments.view',
      'payments.manage',
      'manage_payments',
    ]))

  if (!hasAccess) {
    return {
      error: NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 }),
    }
  }

  return { user }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await assertReceiptAccess(request)
  if ('error' in access && access.error) return access.error
  const { user } = access

  try {
    const result = await generatePaymentReceiptPdf(params.id, user.tenantId)
    if (!result) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Payment receipt download error:', error)
    return NextResponse.json({ error: 'Failed to generate receipt PDF' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await assertReceiptAccess(request)
  if ('error' in access && access.error) return access.error
  const { user } = access

  try {
    const body = await request.json().catch(() => ({}))
    const email = String(body?.email || '').trim()

    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const result = await sendPaymentReceiptForPayment(params.id, user.tenantId, {
      to: email || undefined,
      forceResend: true,
    })

    if (result.reason === 'payment_not_found') {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }
    if (result.reason === 'missing_email') {
      return NextResponse.json({ error: 'No recipient email address provided' }, { status: 400 })
    }
    if (!result.sent) {
      const message =
        result.error ||
        (result.reason === 'send_failed'
          ? 'Failed to send receipt email'
          : result.reason === 'already_sent'
            ? 'Receipt was already sent for this payment'
            : 'Failed to send receipt email')
      const status = result.error?.includes('not configured') ? 400 : 502
      return NextResponse.json({ error: message }, { status })
    }

    return NextResponse.json({
      ok: true,
      sentTo: result.sentTo,
      receiptUrl: result.receiptUrl,
    })
  } catch (error) {
    console.error('Payment receipt email error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
