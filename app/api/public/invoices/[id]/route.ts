import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reconcileSingleInvoiceAchPayment, shouldAttemptPublicInvoiceReconcile } from '@/lib/qbo/reconcile-ach'
import { calculateOrderedSubtotalRows } from '@/lib/documents/subtotals'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = request.nextUrl.searchParams.get('token') || ''
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 })
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: params.id,
        paymentToken: token,
      },
      include: {
        client: true,
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Webhook/redirect fallback: only reconcile when there is a recent/active ACH intent
    // and the last reconcile attempt is stale enough to justify a QBO read.
    try {
      if (await shouldAttemptPublicInvoiceReconcile(invoice.id)) {
        await reconcileSingleInvoiceAchPayment(invoice.id, { source: 'public_invoice_fetch' })
      }
    } catch (e) {
      console.error('[QBO ACH] Reconcile on public invoice fetch failed:', e)
    }

    const freshInvoice = await prisma.invoice.findFirst({
      where: { id: invoice.id },
      include: {
        client: true,
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
    if (!freshInvoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const outstandingWhere = {
      tenantId: freshInvoice.tenantId,
      clientId: freshInvoice.clientId,
      balance: { gt: 0 },
      status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] as any },
    }

    const [outstandingCount, outstandingAgg, outstandingInvoices] = await Promise.all([
      prisma.invoice.count({ where: outstandingWhere as any }),
      prisma.invoice.aggregate({
        where: outstandingWhere as any,
        _sum: { balance: true },
      }),
      prisma.invoice.findMany({
        where: outstandingWhere as any,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          balance: true,
          invoiceDate: true,
          dueDate: true,
        },
        orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
        take: 200,
      }),
    ])

    return NextResponse.json({
      invoice: {
        id: freshInvoice.id,
        invoiceNumber: freshInvoice.invoiceNumber,
        title: freshInvoice.title,
        status: freshInvoice.status,
        subtotal: freshInvoice.subtotal.toString(),
        taxAmount: freshInvoice.taxAmount?.toString() || '0',
        total: freshInvoice.total.toString(),
        balance: freshInvoice.balance.toString(),
        qboAchEnabled: freshInvoice.qboAchEnabled,
        invoiceDate: freshInvoice.invoiceDate,
        dueDate: freshInvoice.dueDate,
        client: {
          name: freshInvoice.client.name,
          companyName: freshInvoice.client.companyName,
        },
        lineItems: calculateOrderedSubtotalRows(freshInvoice.lineItems.filter((li) => li.isVisibleToClient !== false) as any[])
          .map((li: any) => ({
            id: li.id,
            description: li.showDescriptionToCustomer !== false ? li.description : '',
            notes: li.showNotesToCustomer !== false ? (li.notes || '') : '',
            quantity: li.quantity.toString(),
            unitPrice: li.showPriceToCustomer !== false ? li.unitPrice.toString() : '0',
            unitCost: li.showCostToCustomer === true ? li.unitCost?.toString() || '0' : null,
            total: (li.isSubtotal ? li.calculatedSubtotalTotal : li.total).toString(),
            isSubtotal: li.isSubtotal === true,
            showPriceToCustomer: li.showPriceToCustomer !== false,
            showCostToCustomer: li.showCostToCustomer === true,
          })),
        outstanding: {
          count: outstandingCount,
          total: Number((outstandingAgg as any)?._sum?.balance ?? 0),
          invoices: outstandingInvoices.map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            status: (inv as any).status,
            balance: inv.balance.toString(),
            invoiceDate: inv.invoiceDate,
            dueDate: inv.dueDate,
            isCurrent: inv.id === freshInvoice.id,
          })),
        },
      },
    })
  } catch (error) {
    console.error('Public invoice fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

