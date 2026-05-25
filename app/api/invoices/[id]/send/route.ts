import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { testEmailProvider } from '@/lib/integrations/providers/email'
import { getEmailBranding } from '@/lib/email/branding'
import { parseEmailList } from '@/lib/email/recipients'
import { buildInvoiceEmail } from '@/lib/email/templates/invoice'

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

    const total = Number(invoice.total || 0).toFixed(2)
    const balance = Number(invoice.balance || 0).toFixed(2)
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : ''
    const emailBranding = await getEmailBranding(user.tenantId)
    const logoUrl = emailBranding?.emailLogoUrl || emailBranding?.webLogoUrl || ''

    const html = buildInvoiceEmail({
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.client?.companyName || invoice.client?.name || 'Customer',
      title: invoice.title || undefined,
      dueDate: dueDate || undefined,
      total,
      balance,
      sentDisplay: sentDisplay || sentIso,
      pdfUrl,
      paymentLink: paymentLink || undefined,
      message: message ? String(message) : undefined,
      logoUrl: logoUrl || undefined,
      companyName:
        (emailBranding as { businessName?: string; companyName?: string } | null)?.businessName ||
        (emailBranding as { companyName?: string } | null)?.companyName ||
        'TrimPro',
    })

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
