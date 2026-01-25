/**
 * Email Provider Service
 * Supports multiple providers (Resend, SendGrid, AWS SES)
 */

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  replyTo?: string
  metadata?: Record<string, any>
}

interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
  provider?: string
}

const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'resend'
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_FROM_NAME || 'noreply@trimpro.com'
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || EMAIL_FROM

/**
 * Send email using configured provider
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { to, subject, html, text, from = EMAIL_FROM, replyTo = EMAIL_REPLY_TO, metadata } = options

  try {
    switch (EMAIL_PROVIDER.toLowerCase()) {
      case 'resend':
        return await sendViaResend({ to, subject, html, text, from, replyTo, metadata })
      case 'sendgrid':
        return await sendViaSendGrid({ to, subject, html, text, from, replyTo, metadata })
      case 'ses':
      case 'aws':
        return await sendViaSES({ to, subject, html, text, from, replyTo, metadata })
      default:
        console.warn(`Unknown email provider: ${EMAIL_PROVIDER}, falling back to Resend`)
        return await sendViaResend({ to, subject, html, text, from, replyTo, metadata })
    }
  } catch (error: any) {
    console.error('Email send error:', error)
    return {
      success: false,
      error: error.message || 'Failed to send email',
      provider: EMAIL_PROVIDER,
    }
  }
}

/**
 * Send email via Resend
 */
async function sendViaResend(options: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = process.env.EMAIL_API_KEY || process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured')
  }

  const toArray = Array.isArray(options.to) ? options.to : [options.to]

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: options.from,
      to: toArray,
      subject: options.subject,
      html: options.html,
      text: options.text,
      reply_to: options.replyTo,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || `Resend API error: ${response.status}`)
  }

  const data = await response.json()

  return {
    success: true,
    messageId: data.id,
    provider: 'resend',
  }
}

/**
 * Send email via SendGrid
 */
async function sendViaSendGrid(options: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = process.env.EMAIL_API_KEY || process.env.SENDGRID_API_KEY
  if (!apiKey) {
    throw new Error('SENDGRID_API_KEY not configured')
  }

  const toArray = Array.isArray(options.to) ? options.to : [options.to]

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: toArray.map((email) => ({ email })),
        },
      ],
      from: { email: options.from },
      subject: options.subject,
      content: [
        ...(options.html ? [{ type: 'text/html', value: options.html }] : []),
        ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
      ],
      reply_to: options.replyTo ? { email: options.replyTo } : undefined,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`SendGrid API error: ${response.status} - ${errorText}`)
  }

  // SendGrid returns 202 Accepted, extract message ID from headers
  const messageId = response.headers.get('x-message-id') || undefined

  return {
    success: true,
    messageId,
    provider: 'sendgrid',
  }
}

/**
 * Send email via AWS SES (using AWS SDK would be better, but using fetch for simplicity)
 */
async function sendViaSES(options: SendEmailOptions): Promise<SendEmailResult> {
  // Note: AWS SES requires AWS SDK for proper implementation
  // This is a simplified version - in production, use @aws-sdk/client-ses
  throw new Error('AWS SES implementation requires AWS SDK. Please use AWS SDK in production.')
}

/**
 * Send bulk emails (rate-limited)
 */
export async function sendBulkEmails(
  emails: SendEmailOptions[],
  delayMs = 100
): Promise<Array<SendEmailResult & { recipient: string }>> {
  const results: Array<SendEmailResult & { recipient: string }> = []

  for (const email of emails) {
    const recipients = Array.isArray(email.to) ? email.to : [email.to]
    
    for (const recipient of recipients) {
      const result = await sendEmail({ ...email, to: recipient })
      results.push({ ...result, recipient })
      
      // Rate limiting
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  return results
}

/**
 * Resolve template variables in email content
 */
export function resolveTemplateVariables(template: string, variables: Record<string, string>): string {
  let resolved = template
  
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
    resolved = resolved.replace(regex, value || '')
  })

  // Remove unresolved variables (optional - could keep them or show warning)
  resolved = resolved.replace(/\{\{[\w]+\}\}/g, '')

  return resolved
}
