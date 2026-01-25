import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
// import { sendInvoiceEmail } from '@/lib/email' // TODO: Implement

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

    // TODO: Generate PDF (implement PDF generation)
    const pdfUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/invoices/${params.id}/pdf`
    
    // Get payment link if invoice has balance
    let paymentLink: string | undefined
    if (invoice.balance.toNumber() > 0) {
      try {
        const paymentResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/payments/sola/link`, {
          method: 'POST',
          headers: {
            'Authorization': request.headers.get('authorization') || '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ invoiceId: invoice.id }),
        })
        if (paymentResponse.ok) {
          const paymentData = await paymentResponse.json()
          paymentLink = paymentData.paymentLink
        }
      } catch (error) {
        console.error('Failed to generate payment link:', error)
      }
    }
    
    try {
      const { sendInvoiceEmail } = await import('@/lib/services/email')
      await sendInvoiceEmail(recipientEmail, invoice, pdfUrl, paymentLink || '', message || undefined)
    } catch (error) {
      console.error('Failed to send invoice email:', error)
      // Continue anyway
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
        subject: subject || `Invoice ${invoice.invoiceNumber}`,
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
