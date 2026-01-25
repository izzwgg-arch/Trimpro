// Email Service Abstraction
// Supports SendGrid, Mailgun, and AWS SES

const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'sendgrid'
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN
const AWS_SES_REGION = process.env.AWS_SES_REGION || 'us-east-1'
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@trimpro.com'
const FROM_NAME = process.env.FROM_NAME || 'Trim Pro'

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
  temporaryPassword: string,
  loginUrl: string
): Promise<void> {
  const emailService = new EmailService()
  
  await emailService.sendEmail({
    to,
    subject: 'Welcome to Trim Pro - Set Your Password',
    html: `
      <html>
        <body>
          <h2>Welcome to Trim Pro, ${firstName}!</h2>
          <p>You have been invited to join Trim Pro. Please use the following temporary password to log in:</p>
          <p><strong>${temporaryPassword}</strong></p>
          <p>You will be required to set a new password when you first log in.</p>
          <p><a href="${loginUrl}">Click here to log in</a></p>
          <p>This temporary password expires in 7 days.</p>
        </body>
      </html>
    `,
    text: `
      Welcome to Trim Pro, ${firstName}!
      
      You have been invited to join Trim Pro. Please use the following temporary password to log in:
      
      ${temporaryPassword}
      
      You will be required to set a new password when you first log in.
      
      Log in here: ${loginUrl}
      
      This temporary password expires in 7 days.
    `,
  })
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
