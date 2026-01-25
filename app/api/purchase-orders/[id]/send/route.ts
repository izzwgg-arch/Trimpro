import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const { email, subject, message } = body

    // Get purchase order
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
          },
        },
      },
    })

    if (!purchaseOrder) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    // Determine recipient email
    const recipientEmail = email || purchaseOrder.vendorRef?.email

    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'No email address found for vendor. Please provide an email address.' },
        { status: 400 }
      )
    }

    // TODO: Generate PDF (implement PDF generation)
    const pdfUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/purchase-orders/${params.id}/pdf`

    // Calculate totals
    const subtotal = purchaseOrder.lineItems.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.unitPrice))
    }, 0)
    const total = Number(purchaseOrder.total)

    try {
      const { sendEmail } = await import('@/lib/email/provider')
      await sendEmail({
        to: recipientEmail,
        subject: subject || `Purchase Order ${purchaseOrder.poNumber} from Trim Pro`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <h2>Purchase Order ${purchaseOrder.poNumber}</h2>
              ${message ? `<p>${message}</p>` : ''}
              <p>Dear ${purchaseOrder.vendorRef?.contactPerson || purchaseOrder.vendorRef?.name || 'Vendor'},</p>
              <p>Please find attached purchase order ${purchaseOrder.poNumber}.</p>
              <h3>Order Summary:</h3>
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <thead>
                  <tr style="background-color: #f4f4f4;">
                    <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Description</th>
                    <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Quantity</th>
                    <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Unit Price</th>
                    <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${purchaseOrder.lineItems.map((item) => `
                    <tr>
                      <td style="padding: 10px; border: 1px solid #ddd;">${item.description}</td>
                      <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${item.quantity}</td>
                      <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">$${Number(item.unitPrice).toFixed(2)}</td>
                      <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">$${Number(item.total).toFixed(2)}</td>
                    </tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid #ddd; font-weight: bold;">Subtotal:</td>
                    <td style="padding: 10px; text-align: right; border: 1px solid #ddd; font-weight: bold;">$${subtotal.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid #ddd; font-weight: bold;">Total:</td>
                    <td style="padding: 10px; text-align: right; border: 1px solid #ddd; font-weight: bold;">$${total.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
              ${purchaseOrder.expectedDate ? `<p><strong>Expected Delivery Date:</strong> ${new Date(purchaseOrder.expectedDate).toLocaleDateString()}</p>` : ''}
              <p><a href="${pdfUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">Download Purchase Order PDF</a></p>
              <p>Thank you for your business.</p>
            </body>
          </html>
        `,
        text: `
          Purchase Order ${purchaseOrder.poNumber}
          
          ${message || ''}
          
          Dear ${purchaseOrder.vendorRef?.contactPerson || purchaseOrder.vendorRef?.name || 'Vendor'},
          
          Please find attached purchase order ${purchaseOrder.poNumber}.
          
          Order Summary:
          ${purchaseOrder.lineItems.map((item) => `${item.description} - Qty: ${item.quantity} @ $${Number(item.unitPrice).toFixed(2)} = $${Number(item.total).toFixed(2)}`).join('\n')}
          
          Subtotal: $${subtotal.toFixed(2)}
          Total: $${total.toFixed(2)}
          ${purchaseOrder.expectedDate ? `Expected Delivery: ${new Date(purchaseOrder.expectedDate).toLocaleDateString()}` : ''}
          
          Download PDF: ${pdfUrl}
          
          Thank you for your business.
        `,
      })
    } catch (error) {
      console.error('Failed to send purchase order email:', error)
      // Continue anyway - email sending is not critical
    }

    // Update status to ORDERED if it was APPROVED or DRAFT
    if (purchaseOrder.status === 'APPROVED' || purchaseOrder.status === 'DRAFT') {
      await prisma.purchaseOrder.update({
        where: { id: params.id },
        data: { status: 'ORDERED' },
      })
    }

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'OTHER',
        description: `Purchase order ${purchaseOrder.poNumber} sent to ${recipientEmail}`,
      },
    })

    return NextResponse.json({
      message: 'Purchase order sent successfully',
      purchaseOrder: {
        ...purchaseOrder,
        status: purchaseOrder.status === 'APPROVED' || purchaseOrder.status === 'DRAFT' ? 'ORDERED' : purchaseOrder.status,
      },
    })
  } catch (error) {
    console.error('Send purchase order error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
