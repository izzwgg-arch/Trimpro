import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { testEmailProvider } from '@/lib/integrations/providers/email'

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getPublicLinkSecret(): string {
  const secret = String(process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || '').trim()
  if (!secret) throw new Error('ENCRYPTION_KEY (or NEXTAUTH_SECRET) is required for public estimate PDF links')
  return secret
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

    // Get estimate
    const estimate = await prisma.estimate.findFirst({
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

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
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
      estimate.client?.email ? String(estimate.client.email).trim() : '',
      estimate.client?.contacts?.[0]?.email ? String(estimate.client.contacts[0].email).trim() : '',
    ]
      .map((v) => v.trim())
      .filter(Boolean)

    const uniqueRecipientEmails = Array.from(new Set(recipientEmails))

    if (uniqueRecipientEmails.length === 0) {
      return NextResponse.json({ error: 'No email address found for client' }, { status: 400 })
    }

    // Force public base URL in recipient emails to avoid internal/private links.
    const appUrl = 'https://app.trimprony.com'

    const sentEpoch = Date.now()
    const sentIso = new Date(sentEpoch).toISOString()
    const sig = crypto
      .createHmac('sha256', getPublicLinkSecret())
      .update(`${params.id}.${sentEpoch}`)
      .digest('hex')
    // Public signed link so recipients do not need dashboard auth.
    const pdfUrl = `${appUrl}/api/public/estimates/${params.id}/pdf?sent=${sentEpoch}&sig=${sig}`
    const effectiveSubject = `${subject || `Estimate ${estimate.estimateNumber}`} • ${sentIso}`
    
    const emailSecrets = await getIntegrationSecrets(user.tenantId, 'email')
    if (!emailSecrets) {
      return NextResponse.json(
        { error: 'Email integration is not configured. Please configure Email Provider first.' },
        { status: 400 }
      )
    }

    const total = Number(estimate.total || 0).toFixed(2)
    const validUntil = estimate.validUntil ? new Date(estimate.validUntil).toLocaleDateString() : ''
    const safeMessage = message ? escapeHtml(String(message)) : ''
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Estimate ${escapeHtml(estimate.estimateNumber)}</title>
    <style>
      body { margin:0; padding:0; background:#f3f4f6; font-family: Inter, Arial, Helvetica, sans-serif; color:#111827; }
      .wrap { width:100%; padding:24px 12px; }
      .card { max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:16px; overflow:hidden; }
      .top { padding:18px 20px; background:linear-gradient(135deg,#12344d 0%, #1f4b63 100%); color:#fff; }
      .brand { font-weight:800; letter-spacing:0.02em; font-size:18px; }
      .subtitle { margin-top:6px; opacity:0.9; font-size:13px; }
      .content { padding:20px; }
      .h1 { font-size:22px; font-weight:800; margin:0 0 6px; }
      .muted { color:#6b7280; font-size:13px; }
      .pill { display:inline-block; padding:6px 10px; border-radius:999px; background:#f3f4f6; border:1px solid #e5e7eb; font-size:12px; color:#111827; }
      .grid { margin-top:14px; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; }
      .row { display:flex; justify-content:space-between; padding:10px 12px; border-top:1px solid #e5e7eb; }
      .row:first-child { border-top:none; }
      .row:nth-child(even) { background:#f9fafb; }
      .btn { display:inline-block; background:#12344d; color:#fff !important; text-decoration:none; padding:12px 16px; border-radius:12px; font-weight:700; }
      .btn-secondary { background:#ffffff; color:#12344d !important; border:1px solid #cbd5e1; }
      .btns { margin-top:16px; display:flex; gap:10px; flex-wrap:wrap; }
      .footer { padding:14px 20px; background:#f8fafc; border-top:1px solid #e5e7eb; font-size:12px; color:#6b7280; }
      .pre { white-space:pre-wrap; margin:12px 0 0; padding:12px; background:#f8fafc; border:1px solid #e5e7eb; border-radius:12px; color:#111827; font-size:13px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="top">
          <div class="brand">TrimPro</div>
          <div class="subtitle">Estimate ${escapeHtml(estimate.estimateNumber)} • Sent ${escapeHtml(sentIso)}</div>
        </div>
        <div class="content">
          <div class="h1">Please review your estimate</div>
          <div class="muted">${escapeHtml(estimate.title || '')}</div>
          <div style="margin-top:10px;">
            ${validUntil ? `<span class="pill">Valid until: ${escapeHtml(validUntil)}</span>` : ''}
          </div>
          ${safeMessage ? `<div class="pre">${safeMessage}</div>` : ''}

          <div class="grid" role="presentation" aria-hidden="true">
            <div class="row"><span class="muted">Total</span><strong>$${escapeHtml(total)}</strong></div>
          </div>

          <div class="btns">
            <a class="btn" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener noreferrer">View / Download Estimate</a>
          </div>

          <div class="muted" style="margin-top:14px;">
            If you have questions, reply to this email and we’ll help.
          </div>
        </div>
        <div class="footer">
          This message was sent from TrimPro. Estimate: ${escapeHtml(estimate.estimateNumber)}.
        </div>
      </div>
    </div>
  </body>
</html>`

    for (const recipientEmail of uniqueRecipientEmails) {
      const sendResult = await testEmailProvider(emailSecrets, recipientEmail, effectiveSubject, html)
      if (!sendResult.success) {
        console.error('Failed to send estimate email:', sendResult.error || sendResult.message)
        return NextResponse.json(
          { error: sendResult.error || sendResult.message || `Failed to send estimate email to ${recipientEmail}` },
          { status: 502 }
        )
      }
    }

    // Update estimate status
    await prisma.estimate.update({
      where: { id: params.id },
      data: {
        status: 'SENT',
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
        body: message || `Please find attached estimate ${estimate.estimateNumber}.`,
        fromEmail: user.email,
        toEmails: uniqueRecipientEmails,
        estimateId: estimate.id,
        clientId: estimate.clientId || undefined,
        sentAt: new Date(),
      },
    })

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'ESTIMATE_SENT',
        description: `Estimate "${estimate.title}" sent to ${uniqueRecipientEmails.join(', ')}`,
        estimateId: estimate.id,
        clientId: estimate.clientId || undefined,
      },
    })

    return NextResponse.json({ message: 'Estimate sent successfully' })
  } catch (error) {
    console.error('Send estimate error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
