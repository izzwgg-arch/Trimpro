import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { testEmailProvider } from '@/lib/integrations/providers/email'
import { getEmailBranding } from '@/lib/email/branding'
import { parseEmailList } from '@/lib/email/recipients'

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

    // Determine recipient email(s)
    const recipientEmails = [
      ...parseEmailList(emails),
      ...parseEmailList(email),
      ...parseEmailList(invoice.client?.email),
      ...parseEmailList(invoice.client?.contacts?.[0]?.email),
    ]

    const uniqueRecipientEmails = parseEmailList(recipientEmails)

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
    
    const emailSecrets = await getIntegrationSecrets(user.tenantId, 'email')
    if (!emailSecrets) {
      return NextResponse.json(
        { error: 'Email integration is not configured. Please configure Email Provider first.' },
        { status: 400 }
      )
    }

    const safeMessage = message ? escapeHtml(String(message)) : ''
    const total = Number(invoice.total || 0).toFixed(2)
    const balance = Number(invoice.balance || 0).toFixed(2)
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : ''
    const emailBranding = await getEmailBranding(user.tenantId)
    const logoUrl = emailBranding?.emailLogoUrl || emailBranding?.webLogoUrl || ''
    const logoBlock = logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" alt="Brand logo" width="200"
           style="display:inline-block;height:auto;max-height:72px;width:auto;max-width:220px;border:0;margin-bottom:6px;"
           onerror="this.style.display='none'" />`
      : `<div style="font-size:22px;font-weight:800;letter-spacing:-0.3px;color:#f8dea4;margin-bottom:10px;">TrimPro</div>`

    const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" data-tp-lock-colors="1">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
    <style>
      :root { color-scheme: dark; supported-color-schemes: dark; }
      @media only screen and (max-width:600px){
        .main-card{ border-radius:12px !important; }
        .hero-pad{ padding:28px 20px 20px !important; }
        .body-pad{ padding:22px 20px !important; }
        .btn-cell{ display:block !important; width:100% !important; padding:0 0 10px !important; }
        .btn-main{ padding:14px 20px !important; font-size:15px !important; }
      }
      @media (prefers-color-scheme: light){
        :root { color-scheme: light; supported-color-schemes: light; }
        .email-body { background-color:#f8f9fc !important; }
        .main-card { background-color:#ffffff !important; box-shadow:0 8px 24px rgba(15,23,42,0.08),0 2px 8px rgba(15,23,42,0.05) !important; }
        .headline { color:#1f2937 !important; }
        .hero-meta { color:#475569 !important; }
        .body-text { color:#1f2937 !important; }
        .status-badge { background-color:#e5e7eb !important; color:#111827 !important; border-color:#f8dea4 !important; }
        .support-card { background-color:#f1f5f9 !important; border-color:#d5dee8 !important; }
        .support-text, .support-strong { color:#111827 !important; }
        .foot-cell { background-color:#f8fafc !important; border-top-color:#e5e7eb !important; }
        .foot-copy { color:#475569 !important; }
      }
    </style>
  </head>
  <body class="email-body" style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0f172a;padding:24px 12px 40px;">
      <tr>
        <td align="center" valign="top">
          <table role="presentation" class="main-card" cellpadding="0" cellspacing="0" border="0"
            style="max-width:580px;width:100%;background-color:#243f53;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.4),0 2px 8px rgba(0,0,0,0.25);">
            <tr>
              <td style="background-color:#243f53;padding:34px 36px 26px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.07);">
                ${logoBlock}
              </td>
            </tr>
            <tr>
              <td class="hero-pad" style="padding:30px 40px 22px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.07);">
                <div class="status-badge" style="display:inline-block;background-color:#334155;border:1px solid #f8dea4;border-radius:999px;padding:5px 16px;margin-bottom:18px;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.3px;">Invoice Ready</div>
                <h1 class="headline" style="margin:0 0 10px;font-size:28px;font-weight:800;line-height:1.2;letter-spacing:-0.4px;color:#f8dea4;">Your Invoice Is Ready</h1>
                <p class="hero-meta" style="margin:0;font-size:13px;font-weight:600;color:#c4d5e9;">
                  Invoice ${escapeHtml(invoice.invoiceNumber)} &ensp;&bull;&ensp; ${escapeHtml(sentDisplay || sentIso)}
                </p>
              </td>
            </tr>
            <tr>
              <td class="body-pad" style="padding:26px 40px;">
                <p class="body-text" style="margin:0 0 4px;font-size:16px;font-weight:600;color:#f1f5f9;">
                  ${escapeHtml(invoice.client?.companyName || invoice.client?.name || 'Customer')},
                </p>
                <p class="body-text" style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#d5e1f1;">
                  ${escapeHtml(invoice.title || 'Your invoice is now available.')}
                  ${dueDate ? ` Due date ${escapeHtml(dueDate)}.` : ''}
                </p>
                ${
                  safeMessage
                    ? `<p class="body-text" style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#e3edf9;white-space:pre-wrap;">${safeMessage}</p>`
                    : ''
                }
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                  style="background-color:#1e3345;border:1px solid #46627f;border-radius:12px;overflow:hidden;margin-bottom:22px;">
                  <tr>
                    <td style="padding:11px 18px;border-bottom:1px solid #46627f;background-color:#1e3345;">
                      <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#c2d1e3;">Invoice Details</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 18px 0;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr><td style="font-size:13px;color:#c2d1e3;font-weight:600;padding-bottom:12px;width:44%;">Invoice</td><td style="font-size:13px;color:#eff6ff;font-weight:700;text-align:right;padding-bottom:12px;">${escapeHtml(invoice.invoiceNumber)}</td></tr>
                      </table>
                    </td>
                  </tr>
                  <tr><td style="padding:0 18px;"><div style="height:1px;background:#46627f;"></div></td></tr>
                  <tr>
                    <td style="padding:12px 18px 0;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr><td style="font-size:13px;color:#c2d1e3;font-weight:600;padding-bottom:12px;width:44%;">Balance</td><td style="font-size:13px;color:#eff6ff;font-weight:700;text-align:right;padding-bottom:12px;">$${escapeHtml(balance)}</td></tr>
                      </table>
                    </td>
                  </tr>
                  <tr><td style="padding:0 18px;"><div style="height:1px;background:#46627f;"></div></td></tr>
                  <tr>
                    <td style="padding:16px 18px 18px;background:#30495f;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="font-size:11px;color:#cdd9e8;font-weight:700;letter-spacing:1px;text-transform:uppercase;vertical-align:middle;">Total Amount</td>
                          <td style="font-size:38px;font-weight:800;color:#ffffff;text-align:right;line-height:1;letter-spacing:-1.5px;vertical-align:middle;">$${escapeHtml(total)}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px;">
                  <tr>
                    <td align="center" style="font-size:0;">
                      ${paymentLink ? `
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 6px 10px 0;vertical-align:top;">
                        <tr>
                          <td bgcolor="#f0c974" style="border-radius:12px;background-color:#f0c974;">
                            <a href="${escapeHtml(paymentLink)}" target="_blank" rel="noopener noreferrer" style="display:block;padding:16px 48px;font-size:17px;font-weight:700;letter-spacing:0.2px;line-height:1.2;text-align:center;text-decoration:none;color:#1e2937;background-color:#f0c974;border-radius:12px;">Pay Now</a>
                          </td>
                        </tr>
                      </table>` : ''}
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 0 10px;vertical-align:top;">
                        <tr>
                          <td bgcolor="#f0c974" style="border-radius:12px;background-color:#f0c974;">
                            <a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener noreferrer" style="display:block;padding:16px 48px;font-size:17px;font-weight:700;letter-spacing:0.2px;line-height:1.2;text-align:center;text-decoration:none;color:#1e2937;background-color:#f0c974;border-radius:12px;">View / Download Invoice</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="support-card" style="background-color:#263f56;border:1px solid #46627f;border-radius:10px;">
                  <tr>
                    <td style="padding:13px 18px;text-align:center;">
                      <p class="support-text" style="margin:0;font-size:13px;line-height:1.65;color:#d6e3f2;">
                        Questions about this invoice? <strong class="support-strong" style="color:#ffffff;">Reply to this email</strong>.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="foot-cell" style="background-color:#223347;padding:22px 40px 24px;border-top:1px solid #46627f;text-align:center;">
                <p style="margin:0 0 5px;font-size:13px;font-weight:700;color:#f8dea4;letter-spacing:0.2px;">TrimPro</p>
                <p class="foot-copy" style="margin:0;font-size:11px;line-height:1.6;color:#93a9c2;">Invoice ${escapeHtml(invoice.invoiceNumber)} sent to ${escapeHtml(invoice.client?.companyName || invoice.client?.name || 'Customer')}.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

    const sendResult = await testEmailProvider(emailSecrets, uniqueRecipientEmails, effectiveSubject, html)
    if (!sendResult.success) {
      console.error('Failed to send invoice email:', sendResult.error || sendResult.message)
      return NextResponse.json(
        { error: sendResult.error || sendResult.message || 'Failed to send invoice email' },
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
        fromEmail: user.email,
        toEmails: uniqueRecipientEmails,
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
