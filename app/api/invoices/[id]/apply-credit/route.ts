import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { applyClientCreditToInvoice, getClientCreditBalance } from '@/lib/payments/customer-credit'
import { applyCreditToQboPayment } from '@/lib/services/qbo-sync'
import { afterInvoicePayment } from '@/lib/payments/after-invoice-payment'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.manage')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const body = await request.json().catch(() => ({}))
    const requested = Number(body?.amount)
    if (!Number.isFinite(requested) || requested <= 0) {
      return NextResponse.json({ error: 'Enter an amount greater than zero.' }, { status: 400 })
    }

    const result = await applyClientCreditToInvoice({
      tenantId: user.tenantId,
      invoiceId: params.id,
      amount: requested,
    })

    if (result.applied <= 0) {
      return NextResponse.json({ error: 'No credit could be applied.' }, { status: 400 })
    }

    // Reflect each consumed credit in QuickBooks by applying it to this invoice
    // on the existing QBO payment. Best-effort: a QBO failure is logged but does
    // not undo the internal application.
    const qboErrors: string[] = []
    for (const c of result.consumed) {
      if (!c.qboPaymentId) continue
      try {
        await applyCreditToQboPayment({
          tenantId: user.tenantId,
          qboPaymentId: c.qboPaymentId,
          invoiceId: params.id,
          amount: c.amount,
        })
      } catch (e: any) {
        qboErrors.push(e?.message || 'QuickBooks update failed')
        console.error('[apply-credit] QBO sparse-update failed:', { creditId: c.creditId, error: e })
      }
    }

    await afterInvoicePayment(params.id).catch(() => null)

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true, clientId: true, status: true, paidAmount: true, balance: true },
    })
    const creditBalance = invoice
      ? await getClientCreditBalance(invoice.clientId, user.tenantId)
      : 0

    return NextResponse.json({
      ok: true,
      applied: result.applied,
      paymentId: result.paymentId,
      invoice: invoice
        ? {
            id: invoice.id,
            status: invoice.status,
            paidAmount: Number(invoice.paidAmount),
            balance: Number(invoice.balance),
          }
        : null,
      remainingCredit: creditBalance,
      qboWarning: qboErrors.length > 0 ? qboErrors.join('; ') : null,
    })
  } catch (error: any) {
    const message = error?.message || 'Failed to apply credit'
    const knownClientError =
      message.includes('No customer credit') ||
      message.includes('already fully paid') ||
      message.includes('Invoice not found') ||
      message.includes('cannot accept')
    console.error('Apply credit error:', error)
    return NextResponse.json(
      { error: knownClientError ? message : 'Failed to apply credit' },
      { status: knownClientError ? 400 : 500 }
    )
  }
}
