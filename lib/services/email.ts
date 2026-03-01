// Email Service Abstraction
// Supports SendGrid, Mailgun, and AWS SES

const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'sendgrid'
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN
const AWS_SES_REGION = process.env.AWS_SES_REGION || 'us-east-1'
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@trimpro.com'
const FROM_NAME = process.env.FROM_NAME || 'Trim Pro'

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatEmailDate(value: Date | number | string) {
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

interface EmailRequest {
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  subject: string
  text?: string
  html?: string
  attachments?: Array<{
    filename: string
    content: string | Buffer
    type?: string
  }>
}

interface EmailResponse {
  messageId: string
  status: string
  provider: string
}

export class EmailService {
  async sendEmail(request: EmailRequest): Promise<EmailResponse> {
    switch (EMAIL_PROVIDER) {
      case 'sendgrid':
        return this.sendViaSendGrid(request)
      case 'mailgun':
        return this.sendViaMailgun(request)
      case 'ses':
        return this.sendViaSES(request)
      default:
        throw new Error(`Unsupported email provider: ${EMAIL_PROVIDER}`)
    }
  }

  private async sendViaSendGrid(request: EmailRequest): Promise<EmailResponse> {
    if (!SENDGRID_API_KEY) {
      throw new Error('SendGrid API key not configured')
    }

    const to = Array.isArray(request.to) ? request.to : [request.to]
    const personalizations = [{
      to: to.map((email) => ({ email })),
      cc: request.cc ? (Array.isArray(request.cc) ? request.cc : [request.cc]).map((email) => ({ email })) : undefined,
      bcc: request.bcc ? (Array.isArray(request.bcc) ? request.bcc : [request.bcc]).map((email) => ({ email })) : undefined,
    }]

    const body = {
      personalizations,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME,
      },
      subject: request.subject,
      content: [
        request.html ? { type: 'text/html', value: request.html } : undefined,
        request.text ? { type: 'text/plain', value: request.text } : undefined,
      ].filter(Boolean),
      attachments: request.attachments?.map((att) => ({
        content: typeof att.content === 'string' ? att.content : att.content.toString('base64'),
        filename: att.filename,
        type: att.type || 'application/octet-stream',
        disposition: 'attachment',
      })),
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(error.errors?.[0]?.message || error.message || 'SendGrid error')
    }

    return {
      messageId: response.headers.get('x-message-id') || '',
      status: 'sent',
      provider: 'sendgrid',
    }
  }

  private async sendViaMailgun(request: EmailRequest): Promise<EmailResponse> {
    if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
      throw new Error('Mailgun credentials not configured')
    }

    const formData = new FormData()
    formData.append('from', `${FROM_NAME} <${FROM_EMAIL}>`)
    
    const to = Array.isArray(request.to) ? request.to : [request.to]
    to.forEach((email) => formData.append('to', email))
    
    if (request.cc) {
      const cc = Array.isArray(request.cc) ? request.cc : [request.cc]
      cc.forEach((email) => formData.append('cc', email))
    }
    
    if (request.bcc) {
      const bcc = Array.isArray(request.bcc) ? request.bcc : [request.bcc]
      bcc.forEach((email) => formData.append('bcc', email))
    }
    
    formData.append('subject', request.subject)
    if (request.html) formData.append('html', request.html)
    if (request.text) formData.append('text', request.text)

    if (request.attachments) {
      for (const att of request.attachments) {
        const blob = typeof att.content === 'string' 
          ? new Blob([att.content], { type: att.type || 'application/octet-stream' })
          : new Blob([Buffer.isBuffer(att.content) ? new Uint8Array(att.content) : att.content])
        formData.append('attachment', blob, att.filename)
      }
    }

    const response = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(error.message || 'Mailgun error')
    }

    const data = await response.json()
    return {
      messageId: data.id || '',
      status: 'sent',
      provider: 'mailgun',
    }
  }

  private async sendViaSES(request: EmailRequest): Promise<EmailResponse> {
    // AWS SES implementation
    // This would use AWS SDK
    throw new Error('AWS SES implementation pending - use AWS SDK')
  }
}

export const emailService = new EmailService()

// Helper functions for common email types
export async function sendInviteEmail(
  to: string,
  firstName: string,
  setPasswordUrl: string,
  apkDownloadUrl: string
): Promise<void> {
  const emailService = new EmailService()
  const subject = 'Welcome to TrimPro - Create Your Password'
  const html = buildInviteEmailHtml(firstName, setPasswordUrl, apkDownloadUrl)
  const text = buildInviteEmailText(firstName, setPasswordUrl, apkDownloadUrl)

  await emailService.sendEmail({
    to,
    subject,
    html,
    text,
  })
}

export function buildInviteEmailHtml(firstName: string, setPasswordUrl: string, apkDownloadUrl: string): string {
  const safeName = firstName?.trim() || 'there'
  const sentDisplay = formatEmailDate(new Date())
  const safeSetPasswordUrl = escapeHtml(setPasswordUrl)
  const safeApkDownloadUrl = escapeHtml(apkDownloadUrl)
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>Welcome to TrimPro</title>
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
                <div style="font-size:22px; line-height:1.3; font-weight:700; color:rgba(255,255,255,0.92);">TrimPro</div>
                <div style="margin-top:8px; font-size:13px; line-height:1.6; color:rgba(255,255,255,0.68);">
                  New user invitation • ${escapeHtml(sentDisplay)}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 0 28px;">
                <div style="font-size:32px; line-height:1.3; font-weight:700; color:rgba(255,255,255,0.92); margin:0 0 8px 0;">
                  Welcome to TrimPro, ${escapeHtml(safeName)}
                </div>
                <div style="font-size:18px; line-height:1.5; color:rgba(255,255,255,0.68); margin:0 0 16px 0;">
                  Your account is ready to activate
                </div>
                <div style="font-size:14px; line-height:1.65; color:rgba(255,255,255,0.68); margin:0 0 24px 0;">
                  Create your password to activate your account, then sign in to start using TrimPro.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                  <tr>
                    <td class="tp-stack-col" width="50%" valign="top" style="width:50%; padding:0;">
                      <a href="${safeSetPasswordUrl}" style="display:block; text-decoration:none; text-align:center; background:#12344d; color:#ffffff; border-radius:12px; border:1px solid #12344d; font-size:16px; line-height:20px; font-weight:700; padding:15px 16px;">
                        Create Password
                      </a>
                    </td>
                    <td class="tp-stack-col tp-stack-gap" width="12" style="width:12px; font-size:0; line-height:0;">&nbsp;</td>
                    <td class="tp-stack-col" width="50%" valign="top" style="width:50%; padding:0;">
                      <a href="${safeApkDownloadUrl}" style="display:block; text-decoration:none; text-align:center; background:transparent; color:rgba(255,255,255,0.92); border-radius:12px; border:1px solid rgba(255,255,255,0.18); font-size:16px; line-height:20px; font-weight:700; padding:15px 16px;">
                        Download Field App
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px 28px;">
                <div style="font-size:13px; line-height:1.6; color:rgba(255,255,255,0.48);">
                  If the button does not work, copy this link:
                </div>
                <div style="margin-top:6px; font-size:13px; line-height:1.6; color:rgba(255,255,255,0.68); word-break:break-all;">
                  ${safeSetPasswordUrl}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-top:1px solid rgba(255,255,255,0.12);">
                  <tr>
                    <td style="padding-top:16px; font-size:12px; line-height:1.6; color:rgba(255,255,255,0.48);">
                      This invitation was sent by TrimPro.
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
}

export function buildInviteEmailText(firstName: string, setPasswordUrl: string, apkDownloadUrl: string): string {
  const safeName = firstName?.trim() || 'there'
  return `
Welcome to TrimPro, ${safeName}!

Your TrimPro account has been created.
Create your password here:
${setPasswordUrl}

After setting your password, you will be redirected to the login page.

Download TrimPro Field App (Android):
${apkDownloadUrl}
  `.trim()
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const emailService = new EmailService()
  
  await emailService.sendEmail({
    to,
    subject: 'Reset Your Password - Trim Pro',
    html: `
      <html>
        <body>
          <h2>Password Reset Request</h2>
          <p>You requested to reset your password. Click the link below to reset it:</p>
          <p><a href="${resetUrl}">Reset Password</a></p>
          <p>This link expires in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </body>
      </html>
    `,
    text: `
      Password Reset Request
      
      You requested to reset your password. Click the link below to reset it:
      
      ${resetUrl}
      
      This link expires in 1 hour.
      
      If you didn't request this, please ignore this email.
    `,
  })
}

export async function sendEstimateEmail(
  to: string,
  estimate: any,
  pdfUrl: string,
  customMessage?: string
): Promise<void> {
  const emailService = new EmailService()
  
  await emailService.sendEmail({
    to,
    subject: `Estimate ${estimate.estimateNumber} from Trim Pro`,
    html: `
      <html>
        <body>
          <h2>Estimate ${estimate.estimateNumber}</h2>
          ${customMessage ? `<p>${customMessage}</p>` : ''}
          <p>Please find attached your estimate.</p>
          <p><strong>Total: ${estimate.total}</strong></p>
          ${estimate.validUntil ? `<p>Valid until: ${new Date(estimate.validUntil).toLocaleDateString()}</p>` : ''}
          <p><a href="${pdfUrl}">Download Estimate PDF</a></p>
        </body>
      </html>
    `,
    text: `
      Estimate ${estimate.estimateNumber}
      
      ${customMessage || ''}
      
      Please find attached your estimate.
      Total: ${estimate.total}
      ${estimate.validUntil ? `Valid until: ${new Date(estimate.validUntil).toLocaleDateString()}` : ''}
      
      Download: ${pdfUrl}
    `,
    attachments: [
      // PDF attachment would be added here
    ],
  })
}

export async function sendInvoiceEmail(
  to: string,
  invoice: any,
  pdfUrl: string,
  paymentLink: string,
  customMessage?: string
): Promise<void> {
  const emailService = new EmailService()
  
  await emailService.sendEmail({
    to,
    subject: `Invoice ${invoice.invoiceNumber} from Trim Pro`,
    html: `
      <html>
        <body>
          <h2>Invoice ${invoice.invoiceNumber}</h2>
          ${customMessage ? `<p>${customMessage}</p>` : ''}
          <p>Please find attached your invoice.</p>
          <p><strong>Total: ${invoice.total}</strong></p>
          ${invoice.dueDate ? `<p>Due date: ${new Date(invoice.dueDate).toLocaleDateString()}</p>` : ''}
          <p><a href="${pdfUrl}">Download Invoice PDF</a></p>
          ${paymentLink ? `<p><a href="${paymentLink}">Pay Online</a></p>` : ''}
        </body>
      </html>
    `,
    text: `
      Invoice ${invoice.invoiceNumber}
      
      ${customMessage || ''}
      
      Please find attached your invoice.
      Total: ${invoice.total}
      ${invoice.dueDate ? `Due date: ${new Date(invoice.dueDate).toLocaleDateString()}` : ''}
      
      Download: ${pdfUrl}
      ${paymentLink ? `Pay Online: ${paymentLink}` : ''}
    `,
    attachments: [
      // PDF attachment would be added here
    ],
  })
}

export async function sendPaymentReceiptEmail(params: {
  to: string
  invoiceNumber: string
  amount: number
  paidAt?: Date | string | null
  reference?: string | null
  companyName?: string | null
  invoiceUrl?: string | null
  receiptUrl?: string | null
  paymentMethod?: string | null
  providerPaymentId?: string | null
  providerInvoiceId?: string | null
}): Promise<void> {
  const emailService = new EmailService()
  const paidAtText = formatEmailDate(params.paidAt || new Date())
  const amountText = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(params.amount || 0)
  )
  const company = params.companyName || FROM_NAME
  const method = params.paymentMethod || 'ACH'
  const providerPaymentId = params.providerPaymentId || params.reference || ''
  const safeReceiptUrl = escapeHtml(params.receiptUrl || '')
  const safeInvoiceUrl = escapeHtml(params.invoiceUrl || '')
  const safeCompany = escapeHtml(company)

  await emailService.sendEmail({
    to: params.to,
    subject: `Payment receipt for invoice ${params.invoiceNumber}`,
    html: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>Payment receipt</title>
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
                <div style="font-size:22px; line-height:1.3; font-weight:700; color:rgba(255,255,255,0.92);">TrimPro</div>
                <div style="margin-top:8px; font-size:13px; line-height:1.6; color:rgba(255,255,255,0.68);">
                  Receipt for invoice ${escapeHtml(params.invoiceNumber)} • ${escapeHtml(paidAtText)}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 0 28px;">
                <div style="font-size:32px; line-height:1.3; font-weight:700; color:rgba(255,255,255,0.92); margin:0 0 8px 0;">
                  Payment received
                </div>
                <div style="font-size:18px; line-height:1.5; color:rgba(255,255,255,0.68); margin:0 0 16px 0;">
                  Thank you. Your payment has been processed.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px;">
                  <tr>
                    <td style="padding:16px; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.68);">Amount paid</td>
                    <td align="right" style="padding:16px; font-size:28px; line-height:1.3; font-weight:700; color:rgba(255,255,255,0.92);">${escapeHtml(amountText)}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 16px 16px 16px; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.68);">Method</td>
                    <td align="right" style="padding:0 16px 16px 16px; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.92);">${escapeHtml(method)}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 16px 16px 16px; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.68);">Invoice</td>
                    <td align="right" style="padding:0 16px 16px 16px; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.92);">${escapeHtml(params.invoiceNumber)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
                  <tr>
                    ${
                      params.receiptUrl
                        ? `<td class="tp-stack-col" width="50%" valign="top" style="width:50%; padding:0;">
                            <a href="${safeReceiptUrl}" style="display:block; text-decoration:none; text-align:center; background:#12344d; color:#ffffff; border-radius:12px; border:1px solid #12344d; font-size:16px; line-height:20px; font-weight:700; padding:15px 16px;">
                              View Receipt
                            </a>
                          </td>
                          <td class="tp-stack-col tp-stack-gap" width="12" style="width:12px; font-size:0; line-height:0;">&nbsp;</td>`
                        : ''
                    }
                    ${
                      params.invoiceUrl
                        ? `<td class="tp-stack-col" ${params.receiptUrl ? 'width="50%" style="width:50%; padding:0;"' : 'width="100%" style="width:100%; padding:0;"'} valign="top">
                            <a href="${safeInvoiceUrl}" style="display:block; text-decoration:none; text-align:center; background:transparent; color:rgba(255,255,255,0.92); border-radius:12px; border:1px solid rgba(255,255,255,0.18); font-size:16px; line-height:20px; font-weight:700; padding:15px 16px;">
                              View Invoice
                            </a>
                          </td>`
                        : ''
                    }
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px 28px;">
                <div style="font-size:14px; line-height:1.6; color:rgba(255,255,255,0.68);">
                  ${providerPaymentId ? `Payment ID: ${escapeHtml(providerPaymentId)}<br />` : ''}
                  ${params.providerInvoiceId ? `Provider Invoice ID: ${escapeHtml(params.providerInvoiceId)}<br />` : ''}
                  ${params.reference ? `Reference: ${escapeHtml(params.reference)}<br />` : ''}
                  Paid at: ${escapeHtml(paidAtText)}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-top:1px solid rgba(255,255,255,0.12);">
                  <tr>
                    <td style="padding-top:16px; font-size:12px; line-height:1.6; color:rgba(255,255,255,0.48);">
                      This receipt was sent by ${safeCompany}.
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
</html>`,
    text: `
Payment Receipt

Thank you. We received your ACH payment.
Invoice: ${params.invoiceNumber}
Amount paid: ${amountText}
Method: ${method}
Paid at: ${paidAtText}
${providerPaymentId ? `Payment ID: ${providerPaymentId}` : ''}
${params.providerInvoiceId ? `Provider Invoice ID: ${params.providerInvoiceId}` : ''}
${params.reference ? `Reference: ${params.reference}` : ''}
${params.receiptUrl ? `View receipt: ${params.receiptUrl}` : ''}
${params.invoiceUrl ? `View invoice: ${params.invoiceUrl}` : ''}

— ${company}
    `.trim(),
  })
}
