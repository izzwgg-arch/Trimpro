import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { isValidEmail } from '@/lib/email'
import { getOrCreateEstimateApprovalToken } from '@/lib/estimate-approval'
import { sendDocumentEmailWithResolvedSender } from '@/lib/email-integrations/sender'
import { getEmailBranding, applyEmailBrandingHtml } from '@/lib/email/branding'
import { buildEstimateApprovalEmail } from '@/lib/email/templates/estimate-approval'

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
    const effectiveSubject = `${subject || `Estimate ${estimate.estimateNumber}`} • ${sentDisplay || sentIso}`
    
    const total = `$${Number(estimate.total || 0).toFixed(2)}`
    const validUntil = estimate.validUntil
      ? new Date(estimate.validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : ''
    const customerName = estimate.client?.companyName || estimate.client?.name || `${estimate.title || ''}`.trim() || 'Customer'
    const recipientName =
      estimate.client?.contacts?.[0]
        ? `${estimate.client.contacts[0].firstName || ''} ${estimate.client.contacts[0].lastName || ''}`.trim() ||
          customerName
        : customerName
    const emailBranding = await getEmailBranding(user.tenantId)
    const brandName = (emailBranding as any)?.invoiceBusinessName || (emailBranding as any)?.emailFooterText?.split('\n')[0] || 'TrimPro'
    const logoUrl = (emailBranding as any)?.emailLogoUrl || (emailBranding as any)?.webLogoUrl || undefined
    const primaryColor = (emailBranding as any)?.sidebarColor || '#243f53'
    const accentColor = (emailBranding as any)?.buttonColor || '#f8dea4'

    const rawHtml = buildEstimateApprovalEmail({
      recipientName,
      customerName,
      estimateNumber: estimate.estimateNumber,
      total,
      sentDisplay: sentDisplay || sentIso,
      approveUrl,
      pdfUrl,
      message: message ? String(message) : undefined,
      validUntil: validUntil || undefined,
      logoUrl,
      companyName: brandName,
      supportEmail: (emailBranding as any)?.invoiceEmail || undefined,
      primaryColor,
      accentColor,
    })

    const html = applyEmailBrandingHtml(rawHtml, emailBranding)

    const sendResult = await sendDocumentEmailWithResolvedSender({
      tenantId: user.tenantId,
      userId: user.id,
      to: uniqueRecipientEmails,
      subject: effectiveSubject,
      html,
      text: (message ? String(message) : null) || `Estimate ${estimate.estimateNumber} is ready.`,
    })
    if (!sendResult.success) {
      return NextResponse.json(
        { error: sendResult.error || 'Failed to send estimate email' },
        { status: 502 }
      )
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
        fromEmail: sendResult.sender.fromEmail,
        toEmails: uniqueRecipientEmails,
        providerData: {
          senderSource: sendResult.sender.source,
          senderName: sendResult.sender.fromName,
          replyTo: sendResult.sender.replyTo || null,
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
        description: `Estimate "${estimate.title}" sent to ${uniqueRecipientEmails.join(', ')}`,
        estimateId: estimate.id,
        clientId: estimate.clientId || undefined,
      },
    })

    return NextResponse.json({
      message: 'Estimate sent successfully',
      sentRecipients: uniqueRecipientEmails,
      failedRecipients: [],
    })
  } catch (error) {
    console.error('Send estimate error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
