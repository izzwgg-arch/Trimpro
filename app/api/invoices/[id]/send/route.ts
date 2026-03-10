import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { sendDocumentEmailWithResolvedSender } from '@/lib/email-integrations/sender'
import { getEmailBranding, applyEmailBrandingHtml } from '@/lib/email/branding'

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatEmailSentDate(value: Date | number | string) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const datePart = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
  return `${datePart} • ${timePart}`
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const { email, emails, subject, message } = body

    // Get invoice
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        client: {
          include: {
            contacts: {
              where: { isPrimary: true },
              take: 1,
            },
          },
        },
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const normalizeEmails = (value: any): string[] => {
      if (Array.isArray(value)) {
        return value
          .map((v) => String(v || '').trim())
          .filter(Boolean)
      }
      if (typeof value === 'string') {
        return value
          .split(/[,\s;]+/g)
          .map((v) => v.trim())
          .filter(Boolean)
      }
      return []
    }

    // Determine recipient email(s)
    const recipientEmails = [
      ...normalizeEmails(emails),
      ...normalizeEmails(email),
      invoice.client?.email ? String(invoice.client.email).trim() : '',
      invoice.client?.contacts?.[0]?.email ? String(invoice.client.contacts[0].email).trim() : '',
    ]
      .map((v) => v.trim())
      .filter(Boolean)

    const uniqueRecipientEmails = Array.from(new Set(recipientEmails))

    if (uniqueRecipientEmails.length === 0) {
      return NextResponse.json({ error: 'No email address found for client' }, { status: 400 })
    }

    // Force public base URL in recipient emails to avoid internal/private links.
    const appUrl = 'https://app.trimprony.com'

    const token = invoice.paymentToken || randomUUID()
    const sentEpoch = Date.now()
    const sentIso = new Date(sentEpoch).toISOString()
    const sentDisplay = formatEmailSentDate(sentEpoch)
    if (!invoice.paymentToken) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { paymentToken: token },
      })
    }

    // Public, tokenized links so recipients do not need dashboard auth.
    const pdfUrl = `${appUrl}/api/public/invoices/${invoice.id}/pdf?token=${encodeURIComponent(token)}&sent=${sentEpoch}`
    const paymentLink =
      invoice.balance.toNumber() > 0
        ? `${appUrl}/portal/pay/${invoice.id}?token=${encodeURIComponent(token)}&sent=${sentEpoch}`
        : ''
    const effectiveSubject = `${subject || `Invoice ${invoice.invoiceNumber}`} • ${sentDisplay || sentIso}`
    console.log('Invoice email links:', {
      invoiceId: invoice.id,
      appUrl,
      pdfUrl,
      paymentLink,
    })
    
    const safeMessage = message ? escapeHtml(String(message)) : ''
    const total = Number(invoice.total || 0).toFixed(2)
    const balance = Number(invoice.balance || 0).toFixed(2)
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : ''
    const emailBranding = await getEmailBranding(user.tenantId)
    const brandName = (emailBranding as any)?.invoiceBusinessName || 'TrimPro'

    const rawHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .tp-card { border-radius: 16px !important; }
        .tp-stack-col { display:block !important; width:100% !important; }
        .tp-stack-gap { height:8px !important; line-height:8px !important; font-size:8px !important; }
      }
    </style>
  </head>
  <body bgcolor="#ffffff" style="margin:0; padding:0; background:#ffffff; color:rgba(255,255,255,0.92); font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffffff" style="width:100%; background:#ffffff;">
      <tr>
        <td align="center" bgcolor="#ffffff" style="padding:32px 16px; background:#ffffff;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="tp-card" style="width:100%; max-width:600px; background:#111827; border:1px solid rgba(255,255,255,0.08); border-radius:18px;">
            <tr>
              <td style="padding:28px 28px 24px 28px;">
                <div style="font-size:22px; line-height:1.3; font-weight:700; color:rgba(255,255,255,0.92);">${escapeHtml(brandName)}</div>
                <div style="margin-top:8px; font-size:13px; line-height:1.6; color:rgba(255,255,255,0.68);">
                  Invoice ${escapeHtml(invoice.invoiceNumber)} • ${escapeHtml(sentDisplay || sentIso)}
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:0 28px 0 28px;">
                <div style="font-size:32px; line-height:1.3; font-weight:700; color:rgba(255,255,255,0.92); margin:0 0 8px 0;">
                  Your invoice is ready
                </div>
                <div style="font-size:18px; line-height:1.5; color:rgba(255,255,255,0.68); margin:0 0 16px 0;">
                  Invoice for ${escapeHtml(invoice.client?.companyName || invoice.client?.name || 'Customer')}
                </div>
                <div style="font-size:14px; line-height:1.65; color:rgba(255,255,255,0.68); margin:0 0 24px 0;">
                  ${escapeHtml(invoice.title || 'Your invoice is now available.')}
                  ${dueDate ? ` Due date ${escapeHtml(dueDate)}.` : ''}
                </div>
                ${
                  safeMessage
                    ? `<div style="font-size:14px; line-height:1.65; color:rgba(255,255,255,0.92); margin:0 0 24px 0; white-space:pre-wrap;">${safeMessage}</div>`
                    : ''
                }
              </td>
            </tr>

            <tr>
              <td style="padding:0 28px 24px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px;">
                  <tr>
                    <td style="padding:16px; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.68);">Total</td>
                    <td align="right" style="padding:16px; font-size:28px; line-height:1.3; font-weight:700; color:rgba(255,255,255,0.92);">$${escapeHtml(total)}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 16px 16px 16px; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.68);">Balance</td>
                    <td align="right" style="padding:0 16px 16px 16px; font-size:20px; line-height:1.3; font-weight:700; color:rgba(255,255,255,0.92);">$${escapeHtml(balance)}</td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0 28px 24px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                  <tr>
                    ${
                      paymentLink
                        ? `<td class="tp-stack-col" width="50%" valign="top" style="width:50%; padding:0;">
                            <a href="${escapeHtml(paymentLink)}" target="_blank" rel="noopener noreferrer" style="display:block; text-decoration:none; text-align:center; background:#12344d; color:#ffffff; border-radius:12px; border:1px solid #12344d; font-size:16px; line-height:20px; font-weight:700; padding:15px 16px;">
                              Pay Now
                            </a>
                          </td>
                          <td class="tp-stack-col tp-stack-gap" width="12" style="width:12px; font-size:0; line-height:0;">&nbsp;</td>`
                        : ''
                    }
                    <td class="tp-stack-col" ${paymentLink ? 'width="50%" style="width:50%; padding:0;"' : 'width="100%" style="width:100%; padding:0;"'} valign="top">
                      <a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener noreferrer" style="display:block; text-decoration:none; text-align:center; background:transparent; color:rgba(255,255,255,0.92); border-radius:12px; border:1px solid rgba(255,255,255,0.18); font-size:16px; line-height:20px; font-weight:700; padding:15px 16px;">
                        View / Download Invoice
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              paymentLink
                ? `<tr>
                    <td style="padding:0 28px 24px 28px;">
                      <div style="font-size:13px; line-height:1.6; color:rgba(255,255,255,0.48);">
                        If the payment button does not work, copy this link:
                      </div>
                      <div style="margin-top:6px; font-size:13px; line-height:1.6; color:rgba(255,255,255,0.68); word-break:break-all;">
                        ${escapeHtml(paymentLink)}
                      </div>
                    </td>
                  </tr>`
                : ''
            }

            <tr>
              <td style="padding:0 28px 24px 28px;">
                <div style="font-size:14px; line-height:1.6; color:rgba(255,255,255,0.68);">
                  Reply to this email if you have any questions.
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:0 28px 28px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-top:1px solid rgba(255,255,255,0.12);">
                  <tr>
                    <td style="padding-top:16px; font-size:12px; line-height:1.6; color:rgba(255,255,255,0.48);">
                      This message was sent from ${escapeHtml(brandName)}. Invoice ${escapeHtml(invoice.invoiceNumber)}.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

    const html = applyEmailBrandingHtml(rawHtml, emailBranding)

    const sendResult = await sendDocumentEmailWithResolvedSender({
      tenantId: user.tenantId,
      userId: user.id,
      to: uniqueRecipientEmails,
      subject: effectiveSubject,
      html,
      text: safeMessage || `Invoice ${invoice.invoiceNumber} is ready.`,
    })
    if (!sendResult.success) {
      return NextResponse.json(
        { error: sendResult.error || 'Failed to send invoice email' },
        { status: 502 }
      )
    }

    // Update invoice status
    await prisma.invoice.update({
      where: { id: params.id },
      data: {
        status: invoice.status === 'DRAFT' ? 'SENT' : invoice.status,
        sentAt: new Date(),
      },
    })

    // Create email record
    await prisma.email.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        direction: 'OUTBOUND',
        status: 'SENT',
        subject: effectiveSubject,
        body: message || `Please find attached invoice ${invoice.invoiceNumber}.`,
        fromEmail: sendResult.sender.fromEmail,
        toEmails: uniqueRecipientEmails,
        providerData: {
          senderSource: sendResult.sender.source,
          senderName: sendResult.sender.fromName,
          replyTo: sendResult.sender.replyTo || null,
        },
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        sentAt: new Date(),
      },
    })

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'EMAIL_SENT',
        description: `Invoice "${invoice.title}" sent to ${uniqueRecipientEmails.join(', ')}`,
        invoiceId: invoice.id,
        clientId: invoice.clientId,
      },
    })

    return NextResponse.json({ message: 'Invoice sent successfully' })
  } catch (error) {
    console.error('Send invoice error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
