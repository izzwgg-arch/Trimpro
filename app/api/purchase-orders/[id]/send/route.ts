import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { sendEmailWithAttachments } from '@/lib/integrations/providers/email'
import { isValidEmail } from '@/lib/email'
import { renderPurchaseOrderEmailPdfAttachment } from '@/lib/documents/email-pdf-attachments'
import { loadEmailEntityAttachments } from '@/lib/documents/email-entity-attachments'

export const runtime = 'nodejs'

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'purchase_orders.edit')
  if (permError) return permError

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
          include: {
            addresses: {
              where: { type: 'job_site' },
              take: 1,
            },
            client: {
              select: { id: true, name: true },
            },
          },
        },
      },
    })

    if (!purchaseOrder) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    // Determine recipient email
    const recipientEmail = String(email || purchaseOrder.vendorRef?.email || '').trim()

    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'No email address found for vendor. Please provide an email address.' },
        { status: 400 }
      )
    }
    if (!isValidEmail(recipientEmail)) {
      return NextResponse.json({ error: 'Invalid vendor email address' }, { status: 400 })
    }

    // Calculate totals
    const subtotal = purchaseOrder.lineItems.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.unitPrice))
    }, 0)
    const total = Number(purchaseOrder.total)

    const emailSecrets = await getIntegrationSecrets(user.tenantId, 'email')
    if (!emailSecrets) {
      return NextResponse.json(
        { error: 'Email integration is not configured. Please configure Email Provider first.' },
        { status: 400 }
      )
    }

    const pdfAttachment = await renderPurchaseOrderEmailPdfAttachment(purchaseOrder, {
      logoUrl: process.env.PDF_LOGO_URL || process.env.NEXT_PUBLIC_PDF_LOGO_URL || null,
      businessName: 'Trim Pro',
    })
    const uploadedAttachments = await loadEmailEntityAttachments({
      tenantId: user.tenantId,
      entityType: 'purchase_order',
      entityId: purchaseOrder.id,
    })
    const documentNotes = purchaseOrder.notes?.trim() || ''
    const html = `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <h2>Purchase Order ${purchaseOrder.poNumber}</h2>
              ${message ? `<p>${escapeHtml(message)}</p>` : ''}
              <p>Dear ${escapeHtml(purchaseOrder.vendorRef?.contactPerson || purchaseOrder.vendorRef?.name || 'Vendor')},</p>
              <p>Please find attached purchase order ${purchaseOrder.poNumber}.</p>
              ${documentNotes ? `<h3>Notes:</h3><p style="white-space:pre-wrap;">${escapeHtml(documentNotes)}</p>` : ''}
              <h3>Order Summary:</h3>
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <thead>
                  <tr style="background-color: #f4f4f4;">
                    <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Item</th>
                    <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Quantity</th>
                    <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Unit Price</th>
                    <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${purchaseOrder.lineItems.map((item) => `
                    <tr>
                      <td style="padding: 10px; border: 1px solid #ddd;">
                        ${escapeHtml(item.description)}
                        ${item.details?.trim() ? `<div style="font-size:12px;color:#334155;margin-top:4px;"><strong>Description:</strong> ${escapeHtml(item.details.trim())}</div>` : ''}
                        ${item.notes?.trim() ? `<div style="font-size:12px;color:#64748b;margin-top:4px;"><strong>Special notes:</strong> ${escapeHtml(item.notes.trim())}</div>` : ''}
                      </td>
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
              <p>Thank you for your business.</p>
            </body>
          </html>
        `
    const text = `
          Purchase Order ${purchaseOrder.poNumber}
          
          ${message || ''}
          
          Dear ${purchaseOrder.vendorRef?.contactPerson || purchaseOrder.vendorRef?.name || 'Vendor'},
          
          Please find attached purchase order ${purchaseOrder.poNumber}.

          ${documentNotes ? `Notes:\n${documentNotes}\n` : ''}
          
          Order Summary:
          ${purchaseOrder.lineItems.map((item) => {
            const detailLines = [
              item.details?.trim() ? `  Description: ${item.details.trim()}` : '',
              item.notes?.trim() ? `  Special notes: ${item.notes.trim()}` : '',
            ].filter(Boolean)
            const desc = [item.description, ...detailLines].join('\n')
            return `${desc} - Qty: ${item.quantity} @ $${Number(item.unitPrice).toFixed(2)} = $${Number(item.total).toFixed(2)}`
          }).join('\n')}
          
          Subtotal: $${subtotal.toFixed(2)}
          Total: $${total.toFixed(2)}
          ${purchaseOrder.expectedDate ? `Expected Delivery: ${new Date(purchaseOrder.expectedDate).toLocaleDateString()}` : ''}
          
          Thank you for your business.
        `

    const sendResult = await sendEmailWithAttachments({
      secrets: emailSecrets,
      to: recipientEmail,
      subject: subject || `Purchase Order ${purchaseOrder.poNumber} from Trim Pro`,
      html,
      text,
      attachments: [pdfAttachment, ...uploadedAttachments],
    })
    if (!sendResult.success) {
      return NextResponse.json(
        { error: sendResult.error || sendResult.message || 'Failed to send purchase order email' },
        { status: 502 }
      )
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
        purchaseOrderId: purchaseOrder.id,
      },
    })

    try {
      await enqueueQboSync(user.tenantId, 'purchase_order', params.id)
    } catch (error) {
      console.error('QuickBooks purchase order sync trigger error (send):', error)
    }

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
