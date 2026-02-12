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

    const rows = invoice.lineItems
      .map(
        (li) => `
          <tr>
            <td>${li.description}</td>
            <td style="text-align:right">${Number(li.quantity).toFixed(2)}</td>
            <td style="text-align:right">$${Number(li.unitPrice).toFixed(2)}</td>
            <td style="text-align:right">$${Number(li.total).toFixed(2)}</td>
          </tr>
        `
      )
      .join('')

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Invoice ${invoice.invoiceNumber}</title>
    <style>
      body { font-family: Inter, Helvetica, Arial, sans-serif; padding: 24px; color: #111827; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border-bottom: 1px solid #e5e7eb; padding: 10px; font-size: 14px; }
      th { text-align: left; background: #f9fafb; }
      .summary { margin-top: 16px; max-width: 320px; margin-left: auto; }
      .summary-row { display: flex; justify-content: space-between; padding: 4px 0; }
      .total { font-weight: 700; border-top: 1px solid #e5e7eb; margin-top: 8px; padding-top: 8px; }
    </style>
  </head>
  <body>
    <h1>Invoice ${invoice.invoiceNumber}</h1>
    <div>${invoice.title}</div>
    <div>Client: ${invoice.client.name}</div>
    <div>Date: ${invoice.invoiceDate.toISOString().slice(0, 10)}</div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align:right">Qty</th>
          <th style="text-align:right">Unit</th>
          <th style="text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary">
      <div class="summary-row"><span>Subtotal</span><span>$${Number(invoice.subtotal).toFixed(2)}</span></div>
      <div class="summary-row"><span>Tax</span><span>$${Number(invoice.taxAmount).toFixed(2)}</span></div>
      <div class="summary-row total"><span>Total</span><span>$${Number(invoice.total).toFixed(2)}</span></div>
    </div>
  </body>
</html>`

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    })
  } catch (error) {
    console.error('Public invoice pdf error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

