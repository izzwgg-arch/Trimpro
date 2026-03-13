import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { testEmailProvider } from '@/lib/integrations/providers/email'
import { isValidEmail } from '@/lib/email'
import { getOrCreateEstimateApprovalToken } from '@/lib/estimate-approval'
import { getEmailBranding } from '@/lib/email/branding'
import { buildEstimateApprovalEmail } from '@/lib/email/templates/estimate-approval'

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
  return `${datePart} \u2022 ${timePart}`
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
      ...normalizeEmails(estimate.client?.email),
      ...(estimate.client?.contacts || []).flatMap((c) => normalizeEmails(c.email)),
    ]
      .map((v) => v.trim())
      .filter(Boolean)

    const uniqueRecipientEmails = Array.from(new Set(recipientEmails))

    if (uniqueRecipientEmails.length === 0) {
      return NextResponse.json({ error: 'No email address found for client' }, { status: 400 })
    }

    const invalidRecipients = uniqueRecipientEmails.filter((addr) => !isValidEmail(addr))
    if (invalidRecipients.length) {
      return NextResponse.json(
        { error: `Invalid recipient email(s): ${invalidRecipients.join(', ')}` },
        { status: 400 }
      )
    }

    // Force public base URL in recipient emails to avoid internal/private links.
    const appUrl = 'https://app.trimprony.com'

    const sentEpoch = Date.now()
    const sentIso = new Date(sentEpoch).toISOString()
    const sentDisplay = formatEmailSentDate(sentEpoch)
    const sig = crypto
      .createHmac('sha256', getPublicLinkSecret())
      .update(`${params.id}.${sentEpoch}`)
      .digest('hex')
    // Public signed link so recipients do not need dashboard auth.
    const pdfUrl = `${appUrl}/api/public/estimates/${params.id}/pdf?sent=${sentEpoch}&sig=${sig}`
    const approvalToken = await getOrCreateEstimateApprovalToken({
      tenantId: user.tenantId,
      estimateId: estimate.id,
    })
    const approveUrl = approvalToken.url
    const effectiveSubject = `${subject || `Estimate ${estimate.estimateNumber}`} - ${sentDisplay || sentIso}`
    
    const emailSecrets = await getIntegrationSecrets(user.tenantId, 'email')
    if (!emailSecrets) {
      return NextResponse.json(
        { error: 'Email integration is not configured. Please configure Email Provider first.' },
        { status: 400 }
      )
    }

    const customerName = estimate.client?.companyName || estimate.client?.name || `${estimate.title || ''}`.trim() || 'Customer'
    const validUntil = estimate.validUntil ? new Date(estimate.validUntil).toLocaleDateString() : ''
    const emailBranding = await getEmailBranding(user.tenantId)
    // Use the public URL directly — Gmail/Outlook block data: URIs in emails.
    const logoUrl = emailBranding?.emailLogoUrl || emailBranding?.webLogoUrl || undefined

    const html = buildEstimateApprovalEmail({
      recipientName: customerName,
      customerName,
      estimateNumber: estimate.estimateNumber,
      total: `$${Number(estimate.total || 0).toFixed(2)}`,
      sentDisplay: sentDisplay || sentIso,
      approveUrl,
      pdfUrl,
      message: message ? String(message) : undefined,
      validUntil: validUntil || undefined,
      logoUrl: logoUrl || undefined,
      companyName: (emailBranding as any)?.businessName || (emailBranding as any)?.companyName || 'TrimPro',
      supportEmail: (emailBranding as any)?.supportEmail || (emailBranding as any)?.businessEmail || undefined,
    })

    const results: Array<{
      recipient: string
      success: boolean
      message?: string
      error?: string
    }> = []

    for (const recipientEmail of uniqueRecipientEmails) {
      const sendResult = await testEmailProvider(emailSecrets, recipientEmail, effectiveSubject, html)
      results.push({
        recipient: recipientEmail,
        success: !!sendResult.success,
        message: sendResult.message,
        error: sendResult.error,
      })
    }

    const sentRecipients = results.filter((r) => r.success).map((r) => r.recipient)
    const failedRecipients = results.filter((r) => !r.success)

    if (sentRecipients.length === 0) {
      const firstError = failedRecipients[0]?.error || failedRecipients[0]?.message || 'Failed to send estimate email'
      console.error('Failed to send estimate email:', firstError)
      return NextResponse.json({ error: firstError, failedRecipients }, { status: 502 })
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
        status: failedRecipients.length ? 'FAILED' : 'SENT',
        subject: effectiveSubject,
        body: message || `Please find attached estimate ${estimate.estimateNumber}.`,
        fromEmail: user.email,
        toEmails: sentRecipients,
        providerData: {
          recipients: results,
        },
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
        description: failedRecipients.length
          ? `Estimate "${estimate.title}" sent to ${sentRecipients.join(', ')} (failed: ${failedRecipients
              .map((r) => r.recipient)
              .join(', ')})`
          : `Estimate "${estimate.title}" sent to ${sentRecipients.join(', ')}`,
        estimateId: estimate.id,
        clientId: estimate.clientId || undefined,
      },
    })

    return NextResponse.json({
      message: failedRecipients.length ? 'Estimate sent (some recipients failed)' : 'Estimate sent successfully',
      sentRecipients,
      failedRecipients: failedRecipients.map((r) => ({ recipient: r.recipient, error: r.error || r.message || '' })),
    })
  } catch (error) {
    console.error('Send estimate error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
