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

    // Generate HTML for PDF
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Purchase Order ${purchaseOrder.poNumber}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 40px;
              color: #333;
            }
            .header {
              border-bottom: 2px solid #333;
              padding-bottom: 20px;
              margin-bottom: 30px;
            }
            .header h1 {
              margin: 0;
              font-size: 28px;
            }
            .info-section {
              display: flex;
              justify-content: space-between;
              margin-bottom: 30px;
            }
            .info-box {
              flex: 1;
              margin-right: 20px;
            }
            .info-box:last-child {
              margin-right: 0;
            }
            .info-box h3 {
              margin-top: 0;
              border-bottom: 1px solid #ddd;
              padding-bottom: 5px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 20px;
            }
            th, td {
              padding: 12px;
              text-align: left;
              border-bottom: 1px solid #ddd;
            }
            th {
              background-color: #f4f4f4;
              font-weight: bold;
            }
            .text-right {
              text-align: right;
            }
            .totals {
              margin-top: 20px;
              margin-left: auto;
              width: 300px;
            }
            .totals-row {
              display: flex;
              justify-content: space-between;
              padding: 8px 0;
            }
            .totals-row.total {
              border-top: 2px solid #333;
              font-weight: bold;
              font-size: 18px;
              margin-top: 10px;
              padding-top: 10px;
            }
            .footer {
              margin-top: 40px;
              padding-top: 20px;
              border-top: 1px solid #ddd;
              font-size: 12px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Purchase Order</h1>
            <p><strong>PO Number:</strong> ${purchaseOrder.poNumber}</p>
            <p><strong>Date:</strong> ${purchaseOrder.orderDate ? new Date(purchaseOrder.orderDate).toLocaleDateString() : new Date().toLocaleDateString()}</p>
            ${purchaseOrder.expectedDate ? `<p><strong>Expected Delivery:</strong> ${new Date(purchaseOrder.expectedDate).toLocaleDateString()}</p>` : ''}
          </div>

          <div class="info-section">
            <div class="info-box">
              <h3>Vendor</h3>
              <p><strong>${purchaseOrder.vendorRef?.name || purchaseOrder.vendor}</strong></p>
              ${purchaseOrder.vendorRef?.contactPerson ? `<p>Contact: ${purchaseOrder.vendorRef.contactPerson}</p>` : ''}
              ${purchaseOrder.vendorRef?.email ? `<p>Email: ${purchaseOrder.vendorRef.email}</p>` : ''}
              ${purchaseOrder.vendorRef?.phone ? `<p>Phone: ${purchaseOrder.vendorRef.phone}</p>` : ''}
              ${purchaseOrder.vendorRef?.address ? `<p>${purchaseOrder.vendorRef.address}</p>` : ''}
              ${purchaseOrder.vendorRef?.city ? `<p>${[purchaseOrder.vendorRef.city, purchaseOrder.vendorRef.state, purchaseOrder.vendorRef.zipCode].filter(Boolean).join(', ')}</p>` : ''}
            </div>
            ${purchaseOrder.job ? `
              <div class="info-box">
                <h3>Job</h3>
                <p><strong>${purchaseOrder.job.jobNumber}</strong></p>
                <p>${purchaseOrder.job.title}</p>
                <p>Client: ${purchaseOrder.job.client.name}</p>
              </div>
            ` : ''}
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
                  <td>${item.description}</td>
                  <td class="text-right">${item.quantity}</td>
                  <td class="text-right">$${Number(item.unitPrice).toFixed(2)}</td>
                  <td class="text-right">$${Number(item.total).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="totals">
            <div class="totals-row">
              <span>Subtotal:</span>
              <span>$${subtotal.toFixed(2)}</span>
            </div>
            <div class="totals-row total">
              <span>Total:</span>
              <span>$${total.toFixed(2)}</span>
            </div>
          </div>

          <div class="footer">
            <p>This is an official purchase order from Trim Pro.</p>
            <p>Generated on ${new Date().toLocaleString()}</p>
          </div>
        </body>
      </html>
    `

    // Return HTML (can be converted to PDF using a service like Puppeteer or a PDF library)
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `inline; filename="PO-${purchaseOrder.poNumber}.html"`,
      },
    })
  } catch (error) {
    console.error('Generate PDF error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
