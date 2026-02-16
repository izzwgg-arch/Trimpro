import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
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
    const { email, subject, message } = body

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

    // Determine recipient email
    const recipientEmail = email || invoice.client?.email || invoice.client?.contacts[0]?.email

    if (!recipientEmail) {
      return NextResponse.json({ error: 'No email address found for client' }, { status: 400 })
    }

    // Force public base URL in recipient emails to avoid internal/private links.
    const appUrl = 'https://app.trimprony.com'

    const token = invoice.paymentToken || randomUUID()
    const sentEpoch = Date.now()
    const sentIso = new Date(sentEpoch).toISOString()
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
    const effectiveSubject = `${subject || `Invoice ${invoice.invoiceNumber}`} • ${sentIso}`
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

    const html = `
      <html>
        <body>
          <h2>Invoice ${invoice.invoiceNumber}</h2>
          ${message ? `<p>${message}</p>` : ''}
          <p>Please review invoice ${invoice.invoiceNumber}.</p>
          <p><strong>Total: $${Number(invoice.total).toFixed(2)}</strong></p>
          ${invoice.dueDate ? `<p>Due date: ${new Date(invoice.dueDate).toLocaleDateString()}</p>` : ''}
          <p><a href="${pdfUrl}">Download Invoice PDF</a></p>
          ${paymentLink ? `<p><a href="${paymentLink}">Pay Online</a></p>` : ''}
          <p style="color:#6b7280;font-size:12px">Sent: ${sentIso}</p>
        </body>
      </html>
    `

    const sendResult = await testEmailProvider(
      emailSecrets,
      recipientEmail,
      effectiveSubject,
      html
    )

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
        toEmails: [recipientEmail],
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
        description: `Invoice "${invoice.title}" sent to ${recipientEmail}`,
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
