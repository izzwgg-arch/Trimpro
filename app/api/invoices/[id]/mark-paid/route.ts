import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { notifyInvoicePaid } from '@/lib/notifications'
import { syncPaymentToQuickBooks } from '@/lib/services/qbo-sync'

const ALLOWED_METHODS = new Set(['CHECK', 'QUICK_PAY', 'OTHER'])

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json().catch(() => ({}))
    const method = String(body?.method || '').trim().toUpperCase()
    const methodLabel = String(body?.methodLabel || '').trim() // custom label for OTHER
    const amountRaw = body?.amount
    const reference = String(body?.reference || '').trim()
    const paidAtRaw = body?.paidAt ? new Date(String(body.paidAt)) : null
    const processedAt =
      paidAtRaw && !Number.isNaN(paidAtRaw.getTime()) ? paidAtRaw : new Date()

    if (!ALLOWED_METHODS.has(method)) {
      return NextResponse.json(
        { error: 'Payment method must be CHECK, QUICK_PAY, or OTHER' },
        { status: 400 }
      )
    }
    if (method === 'OTHER' && !methodLabel) {
      return NextResponse.json(
        { error: 'Please enter a payment type name.' },
        { status: 400 }
      )
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        client: {
          select: {
            name: true,
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (invoice.status === 'CANCELLED' || invoice.status === 'REFUNDED') {
      return NextResponse.json(
        { error: `Cannot mark a ${invoice.status.toLowerCase()} invoice as paid.` },
        { status: 400 }
      )
    }

    const remaining = Math.max(0, toNumber(invoice.total) - toNumber(invoice.paidAmount))
    if (remaining <= 0) {
      return NextResponse.json({ error: 'Invoice is already fully paid.' }, { status: 400 })
    }

    const requestedAmount = amountRaw === undefined || amountRaw === null ? remaining : toNumber(amountRaw)
    if (requestedAmount <= 0) {
      return NextResponse.json({ error: 'Payment amount must be greater than zero.' }, { status: 400 })
    }

    const amount = Math.min(requestedAmount, remaining)
    const newPaidAmount = toNumber(invoice.paidAmount) + amount
    const newBalance = Math.max(0, toNumber(invoice.total) - newPaidAmount)
    const nextStatus = newBalance <= 0 ? 'PAID' : 'PARTIAL'

    const paymentNotes =
      method === 'CHECK'
        ? 'Manually marked as paid by check'
        : method === 'QUICK_PAY'
          ? 'Manually marked as paid by Quick Pay'
          : `Manually marked as paid — ${methodLabel}`

    const createdPayment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount,
        status: 'COMPLETED',
        method: method === 'CHECK' ? 'CHECK' : 'OTHER',
        provider: method === 'QUICK_PAY' ? 'quick_pay' : method === 'OTHER' ? methodLabel.toLowerCase().replace(/\s+/g, '_') : 'manual',
        reference: reference || null,
        processedAt,
        notes: paymentNotes,
      },
    })

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: newPaidAmount,
        balance: newBalance,
        status: nextStatus as any,
        paidAt: newBalance <= 0 ? processedAt : invoice.paidAt,
      },
    })

    try {
      await syncPaymentToQuickBooks(user.tenantId, createdPayment.id)
    } catch (error) {
      console.error('QuickBooks payment sync trigger error (manual mark paid):', error)
    }

    await notifyInvoicePaid(
      user.tenantId,
      invoice.id,
      invoice.invoiceNumber,
      amount,
      invoice.client?.name || 'Customer'
    ).catch(() => null)

    return NextResponse.json({
      ok: true,
      payment: {
        id: createdPayment.id,
        amount,
        method,
      },
      invoice: {
        id: invoice.id,
        status: nextStatus,
        paidAmount: newPaidAmount,
        balance: newBalance,
      },
    })
  } catch (error) {
    console.error('Manual mark-paid error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
