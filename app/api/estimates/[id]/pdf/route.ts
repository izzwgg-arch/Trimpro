import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const estimate = await prisma.estimate.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            companyName: true,
            email: true,
            phone: true,
          },
        },
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    const visibleItems = estimate.lineItems.filter((item) => item.isVisibleToClient !== false)
    const subtotal = visibleItems.reduce((sum, item) => {
      return sum + Number(item.quantity) * Number(item.unitPrice)
    }, 0)
    const discount = Number(estimate.discount || 0)
    const taxRate = Number(estimate.taxRate || 0)
    const subtotalAfterDiscount = subtotal - discount
    const tax = subtotalAfterDiscount * taxRate
    const total = subtotalAfterDiscount + tax

    const showNotes = estimate.isNotesVisibleToClient !== false && Boolean(estimate.notes)

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Estimate ${estimate.estimateNumber}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; color: #111; }
            h1, h2, h3 { margin: 0; }
            .header { margin-bottom: 24px; }
            .muted { color: #666; font-size: 12px; }
            .section { margin-top: 24px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
            th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.02em; color: #4b5563; }
            td.text-right, th.text-right { text-align: right; }
            .totals { margin-top: 16px; width: 280px; margin-left: auto; }
            .totals-row { display: flex; justify-content: space-between; padding: 6px 0; }
            .totals-row.total { font-weight: bold; border-top: 1px solid #e5e7eb; margin-top: 6px; padding-top: 8px; }
            .notes { white-space: pre-wrap; background: #f9fafb; padding: 12px; border-radius: 6px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Estimate ${estimate.estimateNumber}</h1>
            <div class="muted">Generated on ${new Date().toLocaleString()}</div>
          </div>

          <div class="section">
            <h3>Client</h3>
            <div>${estimate.client?.companyName || estimate.client?.name || 'N/A'}</div>
            ${estimate.client?.email ? `<div class="muted">${estimate.client.email}</div>` : ''}
            ${estimate.client?.phone ? `<div class="muted">${estimate.client.phone}</div>` : ''}
          </div>

          <div class="section">
            <h3>Line Items</h3>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th class="text-right">Qty</th>
                  <th class="text-right">Unit Price</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${
                  visibleItems.length === 0
                    ? `<tr><td colspan="4" class="muted">No visible items</td></tr>`
                    : visibleItems.map((item) => `
                        <tr>
                          <td>${item.description}</td>
                          <td class="text-right">${Number(item.quantity).toFixed(2)}</td>
                          <td class="text-right">$${Number(item.unitPrice).toFixed(2)}</td>
                          <td class="text-right">$${Number(item.total).toFixed(2)}</td>
                        </tr>
                      `).join('')
                }
              </tbody>
            </table>
          </div>

          <div class="totals">
            <div class="totals-row">
              <span>Subtotal:</span>
              <span>$${subtotal.toFixed(2)}</span>
            </div>
            <div class="totals-row">
              <span>Discount:</span>
              <span>-$${discount.toFixed(2)}</span>
            </div>
            <div class="totals-row">
              <span>Tax:</span>
              <span>$${tax.toFixed(2)}</span>
            </div>
            <div class="totals-row total">
              <span>Total:</span>
              <span>$${total.toFixed(2)}</span>
            </div>
          </div>

          ${showNotes ? `
            <div class="section">
              <h3>Notes</h3>
              <div class="notes">${estimate.notes}</div>
            </div>
          ` : ''}

          ${estimate.terms ? `
            <div class="section">
              <h3>Terms & Conditions</h3>
              <div class="notes">${estimate.terms}</div>
            </div>
          ` : ''}
        </body>
      </html>
    `

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `inline; filename="Estimate-${estimate.estimateNumber}.html"`,
      },
    })
  } catch (error) {
    console.error('Generate estimate PDF error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
