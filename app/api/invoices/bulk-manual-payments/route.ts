import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { notifyInvoicePaid } from '@/lib/notifications'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'

const ALLOWED_METHODS = new Set(['CHECK', 'QUICK_PAY', 'OTHER'])

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json().catch(() => ({}))
    const method = String(body?.method || '').trim().toUpperCase()
    const methodLabel = String(body?.methodLabel || '').trim()
    const paidAtRaw = body?.paidAt ? new Date(String(body.paidAt)) : null
    const processedAt =
      paidAtRaw && !Number.isNaN(paidAtRaw.getTime()) ? paidAtRaw : new Date()
    const items = Array.isArray(body?.items) ? body.items : []

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
    if (items.length === 0) {
      return NextResponse.json({ error: 'Select at least one invoice.' }, { status: 400 })
    }

    const requestedIds = Array.from(
      new Set(
        items
          .map((item: any) => String(item?.invoiceId || '').trim())
          .filter(Boolean)
      )
    )
    if (requestedIds.length === 0) {
      return NextResponse.json({ error: 'No valid invoices were provided.' }, { status: 400 })
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        id: { in: requestedIds },
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

    const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]))

    const preparedItems = items.map((item: any) => {
      const invoiceId = String(item?.invoiceId || '').trim()
      const requestedAmount = toNumber(item?.amount)
      const invoice = invoicesById.get(invoiceId)
      const remaining = invoice ? Math.max(0, toNumber(invoice.total) - toNumber(invoice.paidAmount)) : 0
      return {
        invoiceId,
        invoice,
        requestedAmount,
        remaining,
      }
    })

    const invalidItem = preparedItems.find((item) => {
      if (!item.invoice) return true
      if (item.invoice.status === 'CANCELLED' || item.invoice.status === 'REFUNDED') return true
      if (item.remaining <= 0) return true
      if (item.requestedAmount <= 0) return true
      if (item.requestedAmount > item.remaining) return true
      return false
    })

    if (invalidItem) {
      if (!invalidItem.invoice) {
        return NextResponse.json({ error: 'One or more invoices were not found.' }, { status: 404 })
      }
      if (invalidItem.invoice.status === 'CANCELLED' || invalidItem.invoice.status === 'REFUNDED') {
        return NextResponse.json(
          { error: `Invoice ${invalidItem.invoice.invoiceNumber} cannot accept manual payments.` },
          { status: 400 }
        )
      }
      if (invalidItem.remaining <= 0) {
        return NextResponse.json(
          { error: `Invoice ${invalidItem.invoice.invoiceNumber} is already fully paid.` },
          { status: 400 }
        )
      }
      if (invalidItem.requestedAmount <= 0) {
        return NextResponse.json(
          { error: `Payment amount for ${invalidItem.invoice.invoiceNumber} must be greater than zero.` },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: `Payment amount for ${invalidItem.invoice.invoiceNumber} exceeds its remaining balance.` },
        { status: 400 }
      )
    }

    const paymentNotes =
      method === 'CHECK'
        ? 'Manually marked as paid by check'
        : method === 'QUICK_PAY'
          ? 'Manually marked as paid by Quick Pay'
          : `Manually marked as paid — ${methodLabel}`

    const results = await prisma.$transaction(async (tx) => {
      const created: Array<{
        paymentId: string
        invoiceId: string
        invoiceNumber: string
        clientName: string
        amount: number
        newPaidAmount: number
        newBalance: number
        nextStatus: string
      }> = []

      for (const item of preparedItems) {
        const invoice = item.invoice!
        const amount = item.requestedAmount
        const newPaidAmount = toNumber(invoice.paidAmount) + amount
        const newBalance = Math.max(0, toNumber(invoice.total) - newPaidAmount)
        const nextStatus = newBalance <= 0 ? 'PAID' : 'PARTIAL'

        const payment = await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            amount,
            status: 'COMPLETED',
            method: method === 'CHECK' ? 'CHECK' : 'OTHER',
            provider:
              method === 'QUICK_PAY'
                ? 'quick_pay'
                : method === 'OTHER'
                  ? methodLabel.toLowerCase().replace(/\s+/g, '_')
                  : 'manual',
            processedAt,
            notes: paymentNotes,
          },
        })

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            balance: newBalance,
            status: nextStatus as any,
            paidAt: newBalance <= 0 ? processedAt : invoice.paidAt,
          },
        })

        created.push({
          paymentId: payment.id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          clientName: invoice.client?.name || 'Customer',
          amount,
          newPaidAmount,
          newBalance,
          nextStatus,
        })
      }

      return created
    })

    for (const result of results) {
      try {
        await enqueueQboSync(user.tenantId, 'payment', result.paymentId)
      } catch (error) {
        console.error('QuickBooks payment sync trigger error (bulk manual payment):', error)
      }

      await notifyInvoicePaid(
        user.tenantId,
        result.invoiceId,
        result.invoiceNumber,
        result.amount,
        result.clientName
      ).catch(() => null)
    }

    return NextResponse.json({
      ok: true,
      count: results.length,
      totalApplied: results.reduce((sum, item) => sum + item.amount, 0),
      invoices: results.map((item) => ({
        id: item.invoiceId,
        invoiceNumber: item.invoiceNumber,
        status: item.nextStatus,
        paidAmount: item.newPaidAmount,
        balance: item.newBalance,
      })),
    })
  } catch (error) {
    console.error('Bulk manual payment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
