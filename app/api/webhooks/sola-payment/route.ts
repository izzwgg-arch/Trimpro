import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyInvoicePaid, createNotificationsForUsers } from '@/lib/notifications'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { testEmailProvider } from '@/lib/integrations/providers/email'
import { syncJobToQuickBooksProject, syncPaymentToQuickBooks } from '@/lib/services/qbo-sync'

function normalizePhone(value: string | null | undefined) {
  return (value || '').replace(/\D/g, '')
}

function parseJobSiteAddress(address: string | null | undefined) {
  if (!address) return null
  const trimmed = address.trim()
  if (!trimmed) return null
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean)
  const street = parts[0] || trimmed
  const city = parts[1] || ''
  const stateZip = parts[2] || ''
  const stateZipMatch = stateZip.match(/^([A-Za-z]{2})\s+(.+)$/)
  const state = stateZipMatch ? stateZipMatch[1] : stateZip
  const zipCode = stateZipMatch ? stateZipMatch[2] : ''
  return {
    street,
    city,
    state,
    zipCode,
    country: 'US',
  }
}

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`
}

async function sendPaymentReceiptEmail(params: {
  tenantId: string
  to: string
  clientName: string
  invoiceId: string
  invoiceNumber: string
  invoiceToken?: string | null
  amountPaid: number
  paidToDate: number
  balance: number
  transactionId?: string
}) {
  const emailSecrets = await getIntegrationSecrets(params.tenantId, 'email')
  if (!emailSecrets) {
    console.warn('Receipt email skipped: Email integration not configured')
    return
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://app.trimprony.com'

  const now = new Date()
  const subject = `Payment Receipt • Invoice ${params.invoiceNumber} • ${now.toISOString()}`
  const receiptUrl = `${appUrl}/portal/pay/${params.invoiceId}${
    params.invoiceToken ? `?token=${encodeURIComponent(params.invoiceToken)}` : ''
  }`
  const html = `
    <html>
      <body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,Helvetica,Arial,sans-serif;color:#111827;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                <tr>
                  <td style="padding:24px 28px;border-bottom:1px solid #e5e7eb;background:#f9fafb;">
                    <div style="font-size:24px;font-weight:700;line-height:1.2;">Payment Receipt</div>
                    <div style="margin-top:6px;font-size:13px;color:#6b7280;">Invoice ${params.invoiceNumber}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">Hi ${params.clientName || 'there'},</p>
                    <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;">
                      Thank you. We received your payment for invoice <strong>${params.invoiceNumber}</strong>.
                    </p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;padding:12px 14px;">
                      <tr><td style="padding:6px 0;font-size:14px;color:#374151;">Amount Paid</td><td align="right" style="padding:6px 0;font-size:14px;font-weight:700;">${money(params.amountPaid)}</td></tr>
                      <tr><td style="padding:6px 0;font-size:14px;color:#374151;">Paid to Date</td><td align="right" style="padding:6px 0;font-size:14px;">${money(params.paidToDate)}</td></tr>
                      <tr><td style="padding:6px 0;font-size:14px;color:#374151;">Remaining Balance</td><td align="right" style="padding:6px 0;font-size:14px;">${money(params.balance)}</td></tr>
                      <tr><td style="padding:6px 0;font-size:14px;color:#374151;">Date</td><td align="right" style="padding:6px 0;font-size:14px;">${now.toLocaleString()}</td></tr>
                      ${params.transactionId ? `<tr><td style="padding:6px 0;font-size:14px;color:#374151;">Transaction ID</td><td align="right" style="padding:6px 0;font-size:14px;">${params.transactionId}</td></tr>` : ''}
                    </table>
                    <div style="margin-top:18px;">
                      <a href="${receiptUrl}" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">View Receipt</a>
                    </div>
                    <p style="margin:18px 0 0 0;font-size:12px;color:#6b7280;">If you have any questions, just reply to this email.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `

  const result = await testEmailProvider(emailSecrets, params.to, subject, html)
  if (!result.success) {
    console.error('Failed to send payment receipt email:', result.error || result.message)
  }
}

async function sendBulkPaymentReceiptEmail(params: {
  tenantId: string
  to: string
  clientName: string
  amountPaid: number
  appliedCount: number
  transactionId?: string
}) {
  const emailSecrets = await getIntegrationSecrets(params.tenantId, 'email')
  if (!emailSecrets) return

  const now = new Date()
  const subject = `Payment Receipt • ${params.appliedCount} invoice(s) • ${now.toISOString()}`
  const html = `
    <html>
      <body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,Helvetica,Arial,sans-serif;color:#111827;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                <tr>
                  <td style="padding:24px 28px;border-bottom:1px solid #e5e7eb;background:#f9fafb;">
                    <div style="font-size:24px;font-weight:700;line-height:1.2;">Payment Receipt</div>
                    <div style="margin-top:6px;font-size:13px;color:#6b7280;">Outstanding invoices payment</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">Hi ${params.clientName || 'there'},</p>
                    <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;">
                      Thank you. We received your payment and applied it to <strong>${params.appliedCount}</strong> invoice(s).
                    </p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;padding:12px 14px;">
                      <tr><td style="padding:6px 0;font-size:14px;color:#374151;">Amount Paid</td><td align="right" style="padding:6px 0;font-size:14px;font-weight:700;">${money(params.amountPaid)}</td></tr>
                      <tr><td style="padding:6px 0;font-size:14px;color:#374151;">Date</td><td align="right" style="padding:6px 0;font-size:14px;">${now.toLocaleString()}</td></tr>
                      ${params.transactionId ? `<tr><td style="padding:6px 0;font-size:14px;color:#374151;">Transaction ID</td><td align="right" style="padding:6px 0;font-size:14px;">${params.transactionId}</td></tr>` : ''}
                    </table>
                    <p style="margin:18px 0 0 0;font-size:12px;color:#6b7280;">If you have any questions, just reply to this email.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `

  const result = await testEmailProvider(emailSecrets, params.to, subject, html)
  if (!result.success) {
    console.error('Failed to send bulk payment receipt email:', result.error || result.message)
  }
}

async function ensureJobFromInvoice(invoiceId: string): Promise<{
  job: { id: string; jobNumber: string; title: string } | null
  created: boolean
}> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId },
    include: {
      job: {
        select: { id: true, jobNumber: true, title: true },
      },
      estimate: {
        include: {
          lead: true,
          job: {
            select: { id: true, jobNumber: true, title: true },
          },
        },
      },
    },
  })

  if (!invoice) return { job: null, created: false }
  if (invoice.jobId && invoice.job) return { job: invoice.job, created: false }

  const estimate = invoice.estimate
  if (estimate?.jobId && estimate.job) {
    if (invoice.jobId !== estimate.job.id) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { jobId: estimate.job.id },
      })
    }
    return { job: estimate.job, created: false }
  }

  let clientId = invoice.clientId || estimate?.clientId || null
  if (!clientId && estimate?.lead?.convertedToClientId) {
    clientId = estimate.lead.convertedToClientId
  }

  if (!clientId && estimate?.lead) {
    const fullName = `${estimate.lead.firstName} ${estimate.lead.lastName}`.trim()
    const normalizedEmail = (estimate.lead.email || '').trim().toLowerCase()
    const normalizedPhone = normalizePhone(estimate.lead.phone)
    const existingClient = await prisma.client.findFirst({
      where: {
        tenantId: invoice.tenantId,
        OR: [
          ...(normalizedEmail
            ? [{ email: { equals: normalizedEmail, mode: 'insensitive' as const } }]
            : []),
          ...(normalizedPhone ? [{ phone: { contains: normalizedPhone } }] : []),
          {
            AND: [
              { name: { equals: fullName, mode: 'insensitive' } },
              ...(estimate.lead.company
                ? [{ companyName: { equals: estimate.lead.company, mode: 'insensitive' } }]
                : []),
            ],
          },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    })

    if (existingClient) {
      clientId = existingClient.id
    } else {
      const createdClient = await prisma.client.create({
        data: {
          tenantId: invoice.tenantId,
          name: fullName,
          companyName: estimate.lead.company || null,
          email: estimate.lead.email || null,
          phone: estimate.lead.phone || null,
          notes: estimate.lead.notes || null,
          isActive: true,
        },
      })
      clientId = createdClient.id
    }
  }

  if (!clientId) return { job: null, created: false }

  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const createdJob = await prisma.$transaction(async (tx) => {
        const latestJob = await tx.job.findFirst({
          where: { tenantId: invoice.tenantId, jobNumber: { startsWith: 'JOB-' } },
          orderBy: { jobNumber: 'desc' },
          select: { jobNumber: true },
        })
        const latestJobNum = latestJob?.jobNumber
          ? parseInt(String(latestJob.jobNumber).replace(/^JOB-/, ''), 10)
          : 0
        const baseNum = Number.isFinite(latestJobNum) ? latestJobNum : 0
        const jobNumber = `JOB-${String(baseNum + 1 + attempt).padStart(6, '0')}`
        const mergedDescription = [
          estimate?.notes ? `Estimate Notes: ${estimate.notes}` : null,
          invoice.notes ? `Invoice Notes: ${invoice.notes}` : null,
          estimate?.lead?.notes ? `Request Notes: ${estimate.lead.notes}` : null,
        ]
          .filter(Boolean)
          .join('\n\n')
          .trim()

        const createdJob = await tx.job.create({
          data: {
            tenantId: invoice.tenantId,
            clientId,
            jobNumber,
            title: invoice.title || estimate?.title || `Job for ${invoice.invoiceNumber}`,
            description: mergedDescription || null,
            status: 'SCHEDULED',
            priority: 3,
            estimateAmount: estimate?.total || invoice.total,
          },
          select: { id: true, jobNumber: true, title: true },
        })

        const parsedAddress = parseJobSiteAddress(estimate?.jobSiteAddress || estimate?.lead?.jobSiteAddress)
        if (parsedAddress) {
          await tx.address.create({
            data: {
              jobId: createdJob.id,
              type: 'job_site',
              street: parsedAddress.street,
              city: parsedAddress.city,
              state: parsedAddress.state,
              zipCode: parsedAddress.zipCode,
              country: parsedAddress.country,
            },
          })
        }

        if (estimate) {
          await tx.estimate.update({
            where: { id: estimate.id },
            data: {
              clientId,
              jobId: createdJob.id,
              status: 'CONVERTED',
            },
          })
        }

        await tx.invoice.update({
          where: { id: invoice.id },
          data: { jobId: createdJob.id },
        })

        if (estimate?.leadId) {
          await tx.lead.update({
            where: { id: estimate.leadId },
            data: { status: 'CONVERTED' },
          })
        }

        await tx.activity.create({
          data: {
            tenantId: invoice.tenantId,
            type: 'JOB_CREATED',
            description: `Payment received. Invoice "${invoice.invoiceNumber}" converted to job ${createdJob.jobNumber}`,
            clientId,
            invoiceId: invoice.id,
            estimateId: estimate?.id,
            leadId: estimate?.leadId || null,
            jobId: createdJob.id,
          },
        })

        return createdJob
      })
      return { job: createdJob, created: true }
    } catch (err: any) {
      if (err?.code === 'P2002' && err?.meta?.target?.includes?.('jobNumber')) {
        continue
      }
      throw err
    }
  }
  throw new Error('Unable to allocate a unique job number')
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    let body: Record<string, any> = {}
    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      // Cardknox commonly posts x-www-form-urlencoded (xResult=...&xInvoice=...)
      const params = new URLSearchParams(rawBody)
      body = Object.fromEntries(params.entries())
    }

    const resultCode = String(body?.Result || body?.result || body?.xResult || '')
    const paymentStatus = String(body?.status || '').toLowerCase()
    const normalizedResult = resultCode.toUpperCase()
    const isSuccess =
      normalizedResult === 'S' ||
      normalizedResult === 'A' ||
      normalizedResult === 'APPROVED' ||
      paymentStatus === 'completed' ||
      paymentStatus === 'paid' ||
      paymentStatus === 'approved'
    if (!isSuccess) {
      return NextResponse.json({ ok: true, ignored: true })
    }

    const invoiceRef = String(body?.invoiceId || body?.xInvoice || body?.InvoiceID || '')
    if (!invoiceRef) {
      return NextResponse.json({ error: 'Missing invoice reference' }, { status: 400 })
    }

    const paidAmount = Number(body?.amount || body?.xAmount || 0)
    const transactionId = String(
      body?.transactionId || body?.TransactionID || body?.xRefNum || body?.xRefnum || ''
    )

    // Bulk payment reference format: "TPINTENT:<intentKey>"
    if (invoiceRef.startsWith('TPINTENT:')) {
      const intentKey = invoiceRef.slice('TPINTENT:'.length).trim()
      if (!intentKey) return NextResponse.json({ error: 'Missing intent reference' }, { status: 400 })

      const intent = await prisma.idempotencyKey.findUnique({
        where: { key: intentKey },
        select: { tenantId: true, response: true, expiresAt: true },
      })
      if (!intent) return NextResponse.json({ error: 'Payment intent not found' }, { status: 404 })
      if (intent.expiresAt && new Date(intent.expiresAt).getTime() < Date.now()) {
        return NextResponse.json({ error: 'Payment intent expired' }, { status: 400 })
      }

      const resp = (intent.response || {}) as any
      const clientId = String(resp?.clientId || '').trim()
      const invoiceIds = Array.isArray(resp?.invoiceIds) ? resp.invoiceIds.map((x: any) => String(x || '').trim()).filter(Boolean) : []
      if (!clientId || !invoiceIds.length) {
        return NextResponse.json({ error: 'Invalid payment intent' }, { status: 400 })
      }

      const client = await prisma.client.findFirst({
        where: { id: clientId },
        include: {
          contacts: {
            where: { isPrimary: true },
            take: 1,
          },
        },
      })
      if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

      const openInvoices = await prisma.invoice.findMany({
        where: {
          tenantId: intent.tenantId,
          clientId: client.id,
          id: { in: invoiceIds },
          balance: { gt: 0 } as any,
          status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] as any },
        },
        orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
      })

      const totalOutstanding = openInvoices.reduce((sum, inv) => sum + Math.max(0, Number(inv.balance || 0)), 0)
      let remaining = paidAmount > 0 ? paidAmount : totalOutstanding
      let appliedCount = 0
      let appliedTotal = 0

      for (const inv of openInvoices) {
        if (remaining <= 0) break
        const invBalance = Math.max(0, Number(inv.balance || 0))
        if (invBalance <= 0) continue
        const amountForThis = Math.min(remaining, invBalance)
        if (amountForThis <= 0) continue

        const uniqueTxn = transactionId ? `${transactionId}:${inv.id}` : `BULK:${Date.now()}:${inv.id}`
        const exists = await prisma.payment.findFirst({
          where: { solaTransactionId: uniqueTxn },
          select: { id: true },
        })
        if (exists) continue

        const createdPayment = await prisma.payment.create({
          data: {
            invoiceId: inv.id,
            amount: amountForThis,
            status: 'COMPLETED',
            method: 'CARD',
            reference: transactionId || null,
            solaTransactionId: uniqueTxn,
            solaWebhookData: body,
            processedAt: new Date(),
            notes: 'Bulk payment (pay all outstanding invoices)',
          } as any,
        })

        try {
          await syncPaymentToQuickBooks(client.tenantId, createdPayment.id)
        } catch (error) {
          console.error('QuickBooks payment sync trigger error (bulk):', error)
        }

        const newPaidAmount = Number(inv.paidAmount || 0) + amountForThis
        const newBalance = Math.max(0, Number(inv.total || 0) - newPaidAmount)
        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            paidAmount: newPaidAmount,
            balance: newBalance,
            status:
              newBalance <= 0
                ? (inv.progressBillingMode && inv.progressBillingMode !== 'FULL' ? 'PARTIAL' : 'PAID')
                : newPaidAmount > 0
                  ? 'PARTIAL'
                  : inv.status,
            paidAt: newBalance <= 0 ? new Date() : inv.paidAt,
            solaTransactionId: transactionId || inv.solaTransactionId,
          } as any,
        })

        // Best-effort: keep lifecycle consistent (creates job if needed).
        try {
          await ensureJobFromInvoice(inv.id)
        } catch {
          // ignore
        }

        appliedCount += 1
        appliedTotal += amountForThis
        remaining -= amountForThis
      }

      // Notify office/admin/accounting once (avoid spamming N notifications)
      try {
        const users = await prisma.user.findMany({
          where: {
            tenantId: client.tenantId,
            role: { in: ['ADMIN', 'ACCOUNTING', 'OFFICE'] },
            status: 'ACTIVE',
          },
          select: { id: true },
        })
        if (users.length) {
          await createNotificationsForUsers(client.tenantId, users.map((u) => u.id), {
            type: 'PAYMENT_RECEIVED' as any,
            title: 'Payment Received (Multiple Invoices)',
            message: `${client.name} paid ${money(appliedTotal)} applied to ${appliedCount} invoice(s).`,
            linkUrl: '/dashboard/invoices',
            linkType: 'invoice',
            linkId: null as any,
            requiresAck: true,
          } as any)
        }
      } catch {
        // ignore
      }

      // Receipt email (single)
      try {
        const to = client.email || client.contacts?.[0]?.email
        if (to && appliedCount > 0 && appliedTotal > 0) {
          await sendBulkPaymentReceiptEmail({
            tenantId: client.tenantId,
            to,
            clientName: client.name || 'Customer',
            amountPaid: appliedTotal,
            appliedCount,
            transactionId: transactionId || undefined,
          })
        }
      } catch (error) {
        console.error('Bulk receipt email error:', error)
      }

      return NextResponse.json({ ok: true, bulk: true, appliedCount, appliedTotal })
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [{ id: invoiceRef }, { invoiceNumber: invoiceRef }],
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
        estimate: {
          include: {
            lead: true,
          },
        },
      job: {
        select: { id: true, jobNumber: true, title: true },
      },
    },
  })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const remainingBeforePayment = Math.max(0, Number(invoice.total) - Number(invoice.paidAmount))
    const requestedAmount = paidAmount > 0 ? paidAmount : Number(invoice.balance)
    const amount = Math.max(0, Math.min(requestedAmount, remainingBeforePayment))

    const existingPayment = transactionId
      ? await prisma.payment.findFirst({
          where: { solaTransactionId: transactionId },
        })
      : null

    let newPaidAmount = Number(invoice.paidAmount)
    let newBalance = Number(invoice.balance)

    if (!existingPayment && amount > 0) {
      const createdPayment = await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount,
          status: 'COMPLETED',
          method: 'CARD',
          reference: transactionId || null,
          solaTransactionId: transactionId || null,
          solaWebhookData: body,
          processedAt: new Date(),
        },
      })

      try {
        await syncPaymentToQuickBooks(invoice.tenantId, createdPayment.id)
      } catch (error) {
        console.error('QuickBooks payment sync trigger error:', error)
      }
      newPaidAmount = Number(invoice.paidAmount) + amount
      newBalance = Math.max(0, Number(invoice.total) - newPaidAmount)

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaidAmount,
          balance: newBalance,
          status:
            newBalance <= 0
              ? (invoice.progressBillingMode && invoice.progressBillingMode !== 'FULL' ? 'PARTIAL' : 'PAID')
              : newPaidAmount > 0
                ? 'PARTIAL'
                : invoice.status,
          paidAt: newBalance <= 0 ? new Date() : invoice.paidAt,
          solaTransactionId: transactionId || invoice.solaTransactionId,
        },
      })

      const recipientEmail = invoice.client.email || invoice.client.contacts?.[0]?.email
      if (recipientEmail) {
        await sendPaymentReceiptEmail({
          tenantId: invoice.tenantId,
          to: recipientEmail,
          clientName: invoice.client.name || 'Customer',
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceToken: invoice.paymentToken,
          amountPaid: amount,
          paidToDate: newPaidAmount,
          balance: newBalance,
          transactionId: transactionId || undefined,
        })
      }
    }

    if (!existingPayment) {
      await notifyInvoicePaid(
        invoice.tenantId,
        invoice.id,
        invoice.invoiceNumber,
        amount,
        invoice.client.name
      )
    }

    // Auto-create/link job as soon as any payment succeeds (partial or full).
    // This enforces lifecycle: Request -> Estimate -> Invoice -> Job.
    if (newPaidAmount > 0) {
      const { job, created } = await ensureJobFromInvoice(invoice.id)
      if (!created) {
        return NextResponse.json({ ok: true })
      }
      const users = await prisma.user.findMany({
        where: {
          tenantId: invoice.tenantId,
          role: { in: ['ADMIN', 'ACCOUNTING'] },
          status: 'ACTIVE',
        },
        select: { id: true },
      })
      if (users.length > 0) {
        await createNotificationsForUsers(
          invoice.tenantId,
          users.map((u) => u.id),
          {
            type: 'SYSTEM',
            title: 'Payment received. Estimate is now a Job.',
            message: `Invoice #${invoice.invoiceNumber} was ${newBalance <= 0 ? 'paid in full' : 'partially paid'} and is now linked to Job${job ? ` ${job.jobNumber}` : ''}.`,
            linkUrl: job ? `/dashboard/jobs/${job.id}` : `/dashboard/invoices/${invoice.id}`,
            linkType: job ? 'job' : 'invoice',
            linkId: job ? job.id : invoice.id,
            requiresAck: false,
          }
        )
      }
      if (job?.id) {
        try {
          await syncJobToQuickBooksProject(invoice.tenantId, job.id)
        } catch (error) {
          console.error('QuickBooks job/project sync trigger error (payment lifecycle):', error)
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Sola payment webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

