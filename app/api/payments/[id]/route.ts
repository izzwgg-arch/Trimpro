import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import {
  buildCustomPaymentNotes,
  isCustomPayment,
  mapCustomPaymentMethodToDb,
  type CustomPaymentUiMethod,
} from '@/lib/payments/custom-payment'

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
            invoiceNumber: true,
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

    if (!isCustomPayment(payment)) {
      return NextResponse.json(
        { error: 'Only custom (manually recorded) payments can be edited.' },
        { status: 400 }
      )
    }

    const ALLOWED_METHODS = new Set(['CHECK', 'QUICK_PAY', 'OTHER'])
    const resolvedMethod = (methodRaw || '') as CustomPaymentUiMethod | ''
    if (resolvedMethod && !ALLOWED_METHODS.has(resolvedMethod)) {
      return NextResponse.json({ error: 'Invalid payment method.' }, { status: 400 })
    }
    if (resolvedMethod === 'OTHER' && !methodLabel) {
      return NextResponse.json({ error: 'Please enter a payment type name.' }, { status: 400 })
    }

    const beforeSnapshot = {
      amount: round2(toNumber(payment.amount)),
      method: payment.method,
      provider: payment.provider,
      reference: payment.reference,
      processedAt: payment.processedAt,
      notes: payment.notes,
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

      // Map method label — preserve existing values when the client omits method.
      const mapped =
        resolvedMethod && ALLOWED_METHODS.has(resolvedMethod)
          ? mapCustomPaymentMethodToDb(resolvedMethod, methodLabel)
          : { method: payment.method as 'CHECK' | 'CASH' | 'OTHER', provider: payment.provider || 'manual' }

      const newMethod = mapped.method
      const newProvider = mapped.provider
      const newNotes =
        resolvedMethod && ALLOWED_METHODS.has(resolvedMethod)
          ? buildCustomPaymentNotes(resolvedMethod, methodLabel)
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

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'UPDATE',
        entityType: 'Payment',
        entityId: params.id,
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
        changes: {
          invoiceId: payment.invoice.id,
          invoiceNumber: payment.invoice.invoiceNumber,
          before: beforeSnapshot,
          after: {
            amount: Number(result.payment.amount),
            method: result.payment.method,
            provider: result.payment.provider,
            reference: result.payment.reference,
            processedAt: result.payment.processedAt,
            notes: result.payment.notes,
          },
        },
      },
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
