import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const shouldPrint = request.nextUrl.searchParams.get('print') === '1'
    const shouldDownload = request.nextUrl.searchParams.get('download') === '1'

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
    const generatedAt = new Date().toLocaleString()
    const clientName = estimate.client?.companyName || estimate.client?.name || 'N/A'
    const validUntil = estimate.validUntil ? new Date(estimate.validUntil).toLocaleDateString() : 'N/A'
    const estimateDate = new Date(estimate.createdAt).toLocaleDateString()

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Estimate ${estimate.estimateNumber}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              padding: 32px;
              font-family: Inter, Helvetica, Arial, sans-serif;
              color: #111827;
              background: #f8fafc;
            }
            .page {
              max-width: 980px;
              margin: 0 auto;
              background: #fff;
              border: 1px solid #e5e7eb;
              border-radius: 14px;
              padding: 28px;
            }
            .header {
              display: grid;
              grid-template-columns: 1fr auto;
              gap: 20px;
              align-items: start;
              margin-bottom: 24px;
            }
            .logo {
              width: 150px;
              height: 42px;
              border: 1px dashed #cbd5e1;
              border-radius: 8px;
              color: #64748b;
              font-size: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .doc-title {
              margin: 12px 0 0;
              font-size: 30px;
              font-weight: 700;
              letter-spacing: -0.02em;
            }
            .muted { color: #6b7280; font-size: 12px; }
            .meta {
              text-align: right;
              font-size: 13px;
              color: #374151;
              line-height: 1.7;
            }
            .grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 16px;
              margin-bottom: 22px;
            }
            .panel {
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              padding: 14px;
              background: #ffffff;
            }
            .panel h3 {
              margin: 0 0 8px;
              font-size: 12px;
              letter-spacing: 0.06em;
              text-transform: uppercase;
              color: #6b7280;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              overflow: hidden;
            }
            th, td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
            th {
              text-align: left;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.06em;
              color: #6b7280;
              background: #f8fafc;
            }
            tbody tr:nth-child(even) { background: #f9fafb; }
            td.text-right, th.text-right { text-align: right; }
            .summary {
              margin-top: 16px;
              margin-left: auto;
              width: 320px;
              background: #f3f4f6;
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              padding: 14px;
            }
            .summary h4 {
              margin: 0 0 10px;
              font-size: 12px;
              letter-spacing: 0.06em;
              text-transform: uppercase;
              color: #6b7280;
            }
            .summary-row {
              display: flex;
              justify-content: space-between;
              padding: 5px 0;
              font-size: 14px;
            }
            .summary-row.total {
              margin-top: 6px;
              padding-top: 8px;
              border-top: 1px solid #cbd5e1;
              font-size: 18px;
              font-weight: 700;
            }
            .notes {
              white-space: pre-wrap;
              background: #f8fafc;
              border: 1px solid #e5e7eb;
              padding: 12px;
              border-radius: 10px;
              line-height: 1.5;
            }
            .section { margin-top: 20px; }
            @media print {
              body { background: #fff; padding: 0; }
              .page { border: none; border-radius: 0; }
            }
          </style>
          ${shouldPrint ? '<script>window.addEventListener("load", () => window.print());</script>' : ''}
        </head>
        <body>
          <div class="page">
            <div class="header">
              <div>
                <div class="logo">LOGO</div>
                <h1 class="doc-title">Estimate</h1>
                <div class="muted">Generated on ${generatedAt}</div>
              </div>
              <div class="meta">
                <div><strong>No.</strong> ${escapeHtml(estimate.estimateNumber)}</div>
                <div><strong>Status:</strong> ${escapeHtml(estimate.status)}</div>
                <div><strong>Valid Until:</strong> ${escapeHtml(validUntil)}</div>
              </div>
            </div>

            <div class="grid">
              <div class="panel">
                <h3>Prepared For</h3>
                <div>${escapeHtml(clientName)}</div>
                ${estimate.client?.email ? `<div class="muted">${escapeHtml(estimate.client.email)}</div>` : ''}
                ${estimate.client?.phone ? `<div class="muted">${escapeHtml(estimate.client.phone)}</div>` : ''}
              </div>
              <div class="panel">
                <h3>Document Details</h3>
                <div class="muted">Estimate Date</div>
                <div>${estimateDate}</div>
                <div class="muted" style="margin-top:8px;">Reference</div>
                <div>${escapeHtml(estimate.title || estimate.estimateNumber)}</div>
              </div>
            </div>

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
                    ? '<tr><td colspan="4" class="muted">No visible items</td></tr>'
                    : visibleItems.map((item) => `
                        <tr>
                          <td>${escapeHtml(item.description)}</td>
                          <td class="text-right">${Number(item.quantity).toFixed(2)}</td>
                          <td class="text-right">$${Number(item.unitPrice).toFixed(2)}</td>
                          <td class="text-right">$${Number(item.total).toFixed(2)}</td>
                        </tr>
                      `).join('')
                }
              </tbody>
            </table>

            <div class="summary">
              <h4>Summary</h4>
              <div class="summary-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
              <div class="summary-row"><span>Discount</span><span>-$${discount.toFixed(2)}</span></div>
              <div class="summary-row"><span>Tax</span><span>$${tax.toFixed(2)}</span></div>
              <div class="summary-row total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
            </div>

            ${showNotes ? `
              <div class="section">
                <h3>Notes</h3>
                <div class="notes">${escapeHtml(estimate.notes || '')}</div>
              </div>
            ` : ''}

            ${estimate.terms ? `
              <div class="section">
                <h3>Terms & Conditions</h3>
                <div class="notes">${escapeHtml(estimate.terms)}</div>
              </div>
            ` : ''}
          </div>
        </body>
      </html>
    `

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Estimate-${estimate.estimateNumber}.html"`,
      },
    })
  } catch (error) {
    console.error('Generate estimate PDF error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
