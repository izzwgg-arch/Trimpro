import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

    const outstandingWhere = {
      tenantId: invoice.tenantId,
      clientId: invoice.clientId,
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
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        title: invoice.title,
        status: invoice.status,
        subtotal: invoice.subtotal.toString(),
        taxAmount: invoice.taxAmount.toString(),
        total: invoice.total.toString(),
        balance: invoice.balance.toString(),
        qboAchEnabled: invoice.qboAchEnabled,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        client: {
          name: invoice.client.name,
          companyName: invoice.client.companyName,
        },
        lineItems: invoice.lineItems.map((li) => ({
          id: li.id,
          description: li.description,
          quantity: li.quantity.toString(),
          unitPrice: li.unitPrice.toString(),
          total: li.total.toString(),
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
            isCurrent: inv.id === invoice.id,
          })),
        },
      },
    })
  } catch (error) {
    console.error('Public invoice fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

