import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { testEmailProvider } from '@/lib/integrations/providers/email'

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
    // TODO: add public estimate route for unauthenticated recipients.
    const pdfUrl = `${appUrl}/api/estimates/${params.id}/pdf?sent=${sentEpoch}`
    const effectiveSubject = `${subject || `Estimate ${estimate.estimateNumber}`} • ${sentIso}`
    
    const emailSecrets = await getIntegrationSecrets(user.tenantId, 'email')
    if (!emailSecrets) {
      return NextResponse.json(
        { error: 'Email integration is not configured. Please configure Email Provider first.' },
        { status: 400 }
      )
    }

    const html = `
      <html>
        <body>
          <h2>Estimate ${estimate.estimateNumber}</h2>
          ${message ? `<p>${message}</p>` : ''}
          <p>Please review estimate ${estimate.estimateNumber}.</p>
          <p><strong>Total: ${estimate.total}</strong></p>
          ${estimate.validUntil ? `<p>Valid until: ${new Date(estimate.validUntil).toLocaleDateString()}</p>` : ''}
          <p><a href="${pdfUrl}">Download Estimate PDF</a></p>
          <p style="color:#6b7280;font-size:12px">Sent: ${sentIso}</p>
        </body>
      </html>
    `

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
