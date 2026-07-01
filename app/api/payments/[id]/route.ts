import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'

const EDITABLE_PROVIDERS = new Set(['manual', 'quick_pay', 'check', null, undefined, ''])
const EDITABLE_METHODS = new Set(['CHECK', 'CASH', 'OTHER'])

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.view')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const body = await request.json().catch(() => ({}))
    const amountRaw = body?.amount
    const methodRaw = String(body?.method || '').trim().toUpperCase()
    const methodLabel = String(body?.methodLabel || '').trim()
    const reference = String(body?.reference || '').trim() || null
    const paidAtRaw = body?.paidAt ? new Date(String(body.paidAt)) : null

    const payment = await prisma.payment.findUnique({
      where: { id: params.id },
      include: {
        invoice: {
          select: {
            id: true,
            tenantId: true,
            total: true,
            status: true,
            paidAt: true,
          },
        },
      },
    })

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }
    if (payment.invoice.tenantId !== user.tenantId) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Only allow editing payments that were manually recorded, not card/ACH gateway payments.
    const provider = payment.provider || ''
    if (!EDITABLE_PROVIDERS.has(provider) || !EDITABLE_METHODS.has(payment.method)) {
      return NextResponse.json(
        { error: 'Only manually recorded payments (check, quick pay, other) can be edited.' },
        { status: 400 }
      )
    }

    const ALLOWED_METHODS = new Set(['CHECK', 'QUICK_PAY', 'OTHER'])
    if (methodRaw && !ALLOWED_METHODS.has(methodRaw)) {
      return NextResponse.json({ error: 'Invalid payment method.' }, { status: 400 })
    }
    if (methodRaw === 'OTHER' && !methodLabel) {
      return NextResponse.json({ error: 'Please enter a payment type name.' }, { status: 400 })
    }

    const processedAt =
      paidAtRaw && !Number.isNaN(paidAtRaw.getTime())
        ? paidAtRaw
        : payment.processedAt ?? new Date()

    const invoiceId = payment.invoice.id

    const result = await prisma.$transaction(async (tx) => {
      // Lock the invoice row to prevent concurrent payment changes.
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`

      // Fetch all payments for this invoice (excluding this one) to recalculate totals.
      const otherPayments = await tx.payment.findMany({
        where: {
          invoiceId,
          id: { not: params.id },
          status: 'COMPLETED',
        },
        select: { amount: true },
      })

      const total = round2(toNumber(payment.invoice.total))

      // Determine the new amount — clamped to what's owed by the OTHER payments.
      const otherPaid = round2(
        otherPayments.reduce((sum, p) => sum + toNumber(p.amount), 0)
      )
      const maxAllowable = round2(Math.max(0, total - otherPaid))

      let newAmount: number
      if (amountRaw === undefined || amountRaw === null) {
        newAmount = round2(toNumber(payment.amount))
      } else {
        const requested = round2(toNumber(amountRaw))
        if (requested <= 0) throw new Error('Amount must be greater than zero.')
        newAmount = Math.min(requested, maxAllowable)
        if (newAmount <= 0) throw new Error('No remaining balance to apply payment to.')
      }

      // Map method label.
      const newMethod =
        methodRaw === 'CHECK'
          ? ('CHECK' as const)
          : methodRaw === 'QUICK_PAY' || methodRaw === 'CASH'
            ? ('CASH' as const)
            : methodRaw === 'OTHER'
              ? ('OTHER' as const)
              : payment.method
      const newProvider =
        methodRaw === 'QUICK_PAY'
          ? 'quick_pay'
          : methodRaw === 'OTHER'
            ? (methodLabel.toLowerCase().replace(/\s+/g, '_') || payment.provider || 'manual')
            : methodRaw === 'CHECK'
              ? 'manual'
              : payment.provider || 'manual'
      const newNotes =
        methodRaw === 'CHECK'
          ? 'Manually marked as paid by check'
          : methodRaw === 'QUICK_PAY'
            ? 'Manually marked as paid by Quick Pay'
            : methodRaw === 'OTHER' && methodLabel
              ? `Manually marked as paid — ${methodLabel}`
              : payment.notes

      const updatedPayment = await tx.payment.update({
        where: { id: params.id },
        data: {
          amount: newAmount,
          method: newMethod,
          provider: newProvider,
          reference: reference !== null ? reference : payment.reference,
          processedAt,
          notes: newNotes ?? payment.notes,
        },
        select: { id: true, amount: true, method: true, status: true, processedAt: true, reference: true, provider: true, notes: true },
      })

      // Recalculate invoice totals from all completed payments.
      const newPaidAmount = round2(otherPaid + newAmount)
      const newBalance = round2(Math.max(0, total - newPaidAmount))
      const fullyPaid = newBalance <= 0.005

      const nextStatus = fullyPaid
        ? 'PAID'
        : newPaidAmount > 0
          ? 'PARTIAL'
          : 'SENT'

      const updatedInvoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: newPaidAmount,
          balance: fullyPaid ? 0 : newBalance,
          status: nextStatus as any,
          paidAt: fullyPaid
            ? (payment.invoice.paidAt ?? processedAt)
            : null,
        },
        select: { paidAmount: true, balance: true, status: true },
      })

      return { payment: updatedPayment, invoice: updatedInvoice }
    })

    // Re-sync to QuickBooks.
    try {
      await enqueueQboSync(user.tenantId, 'payment', params.id)
    } catch (error) {
      console.error('QuickBooks sync trigger error (edit payment):', error)
    }

    return NextResponse.json({
      ok: true,
      payment: {
        id: result.payment.id,
        amount: Number(result.payment.amount),
        method: result.payment.method,
        status: result.payment.status,
        processedAt: result.payment.processedAt,
        reference: result.payment.reference,
        provider: result.payment.provider,
        notes: result.payment.notes,
      },
      invoice: {
        paidAmount: Number(result.invoice.paidAmount),
        balance: Number(result.invoice.balance),
        status: result.invoice.status,
      },
    })
  } catch (error: any) {
    if (error?.message && error.message.length < 200) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Edit payment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
