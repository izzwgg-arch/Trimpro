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

    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        vendorRef: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            zipCode: true,
            contactPerson: true,
          },
        },
        lineItems: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
        job: {
          select: {
            id: true,
            jobNumber: true,
            title: true,
            client: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    })

    if (!purchaseOrder) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    // Calculate totals
    const subtotal = purchaseOrder.lineItems.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.unitPrice))
    }, 0)
    const total = Number(purchaseOrder.total)
    const generatedAt = new Date().toLocaleString()
    const orderDate = purchaseOrder.orderDate ? new Date(purchaseOrder.orderDate).toLocaleDateString() : new Date().toLocaleDateString()
    const expectedDate = purchaseOrder.expectedDate ? new Date(purchaseOrder.expectedDate).toLocaleDateString() : 'N/A'

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Purchase Order ${purchaseOrder.poNumber}</title>
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
            .meta {
              text-align: right;
              font-size: 13px;
              color: #374151;
              line-height: 1.7;
            }
            .muted { color: #6b7280; font-size: 12px; }
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
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              overflow: hidden;
            }
            th, td {
              padding: 10px 12px;
              border-bottom: 1px solid #e5e7eb;
            }
            th {
              text-align: left;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.06em;
              color: #6b7280;
              background: #f8fafc;
            }
            tbody tr:nth-child(even) { background: #f9fafb; }
            .text-right {
              text-align: right;
            }
            .summary {
              margin-top: 20px;
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
              font-weight: bold;
              font-size: 18px;
            }
            .footer {
              margin-top: 22px;
              padding-top: 12px;
              border-top: 1px solid #e5e7eb;
              font-size: 12px;
              color: #6b7280;
            }
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
                <h1 class="doc-title">Purchase Order</h1>
                <div class="muted">Generated on ${generatedAt}</div>
              </div>
              <div class="meta">
                <div><strong>No.</strong> ${escapeHtml(purchaseOrder.poNumber)}</div>
                <div><strong>Order Date:</strong> ${escapeHtml(orderDate)}</div>
                <div><strong>Expected:</strong> ${escapeHtml(expectedDate)}</div>
              </div>
            </div>

            <div class="grid">
              <div class="panel">
                <h3>Vendor</h3>
                <div><strong>${escapeHtml(purchaseOrder.vendorRef?.name || purchaseOrder.vendor || 'N/A')}</strong></div>
                ${purchaseOrder.vendorRef?.contactPerson ? `<div class="muted">Contact: ${escapeHtml(purchaseOrder.vendorRef.contactPerson)}</div>` : ''}
                ${purchaseOrder.vendorRef?.email ? `<div class="muted">${escapeHtml(purchaseOrder.vendorRef.email)}</div>` : ''}
                ${purchaseOrder.vendorRef?.phone ? `<div class="muted">${escapeHtml(purchaseOrder.vendorRef.phone)}</div>` : ''}
              </div>
              <div class="panel">
                <h3>Job</h3>
                ${purchaseOrder.job ? `
                  <div><strong>${escapeHtml(purchaseOrder.job.jobNumber)}</strong></div>
                  <div>${escapeHtml(purchaseOrder.job.title)}</div>
                  <div class="muted">Client: ${escapeHtml(purchaseOrder.job.client.name)}</div>
                ` : '<div class="muted">No linked job</div>'}
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th class="text-right">Quantity</th>
                  <th class="text-right">Unit Price</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${purchaseOrder.lineItems.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.description)}</td>
                    <td class="text-right">${Number(item.quantity).toFixed(2)}</td>
                    <td class="text-right">$${Number(item.unitPrice).toFixed(2)}</td>
                    <td class="text-right">$${Number(item.total).toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <div class="summary">
              <h4>Summary</h4>
              <div class="summary-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
              <div class="summary-row total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
            </div>

            <div class="footer">
              <p>This is an official purchase order from Trim Pro.</p>
              <p>Generated on ${generatedAt}</p>
            </div>
          </div>
        </body>
      </html>
    `

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="PO-${purchaseOrder.poNumber}.html"`,
      },
    })
  } catch (error) {
    console.error('Generate PDF error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
