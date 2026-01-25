import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
// import { sendEstimateEmail } from '@/lib/email' // TODO: Implement

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

    // Determine recipient email
    const recipientEmail = email || estimate.client?.email || estimate.client?.contacts[0]?.email

    if (!recipientEmail) {
      return NextResponse.json({ error: 'No email address found for client' }, { status: 400 })
    }

    // TODO: Generate PDF (implement PDF generation)
    const pdfUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/estimates/${params.id}/pdf`
    
    try {
      const { sendEstimateEmail } = await import('@/lib/services/email')
      await sendEstimateEmail(recipientEmail, estimate, pdfUrl, message || undefined)
    } catch (error) {
      console.error('Failed to send estimate email:', error)
      // Continue anyway
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
        subject: subject || `Estimate ${estimate.estimateNumber}`,
        body: message || `Please find attached estimate ${estimate.estimateNumber}.`,
        fromEmail: user.email,
        toEmails: [recipientEmail],
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
        description: `Estimate "${estimate.title}" sent to ${recipientEmail}`,
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
