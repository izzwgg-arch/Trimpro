import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyInvoicePaid, createNotificationsForUsers } from '@/lib/notifications'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { testEmailProvider } from '@/lib/integrations/providers/email'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import { getEmailBranding } from '@/lib/email/branding'
import { getEstimateConversionSummary } from '@/lib/documents/conversion'

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
  const emailBranding = await getEmailBranding(params.tenantId)
  const brandLogoUrl = String(emailBranding?.emailLogoUrl || emailBranding?.webLogoUrl || '').trim()
  const headerBrandBlock = brandLogoUrl
    ? `<img src="${brandLogoUrl}" alt="Brand logo" width="200" style="display:inline-block;height:auto;max-height:72px;width:auto;max-width:220px;border:0;margin-bottom:6px;" onerror="this.style.display='none'" />`
    : `<div style="font-size:22px;font-weight:800;color:#f8dea4;">TrimPro</div>`
  const html = `
    <html lang="en">
      <head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <style>
          @media (prefers-color-scheme: light){
            .email-body{ background:#f8f9fc !important; }
            .main-card{ background:#ffffff !important; box-shadow:0 8px 24px rgba(15,23,42,0.08) !important; }
            .headline{ color:#1f2937 !important; }
            .hero-meta{ color:#475569 !important; }
            .body-copy{ color:#1f2937 !important; }
            .status-badge{ background:#e5e7eb !important; color:#111827 !important; border-color:#f8dea4 !important; }
          }
        </style>
      </head>
      <body class="email-body" style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a;padding:24px 12px 40px;">
          <tr><td align="center">
            <table role="presentation" width="580" class="main-card" cellspacing="0" cellpadding="0" style="max-width:580px;width:100%;background:#243f53;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.4);">
              <tr><td style="background:#243f53;padding:34px 36px 26px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.07);">
                ${headerBrandBlock}
                <p style="margin:8px 0 0;font-size:11px;font-weight:600;letter-spacing:2px;color:#f5e3aa;text-transform:uppercase;">Payment Receipt</p>
              </td></tr>
              <tr><td style="padding:30px 40px 22px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.07);">
                <div class="status-badge" style="display:inline-block;background:#334155;border:1px solid #f8dea4;border-radius:999px;padding:5px 16px;margin-bottom:18px;color:#fff;font-size:12px;font-weight:700;">Payment Confirmed</div>
                <h1 class="headline" style="margin:0 0 10px;font-size:28px;line-height:1.2;font-weight:800;color:#f8dea4;">Payment Received</h1>
                <p class="hero-meta" style="margin:0;color:#c4d5e9;font-size:13px;font-weight:600;">Invoice ${params.invoiceNumber} &bull; ${now.toLocaleString()}</p>
              </td></tr>
              <tr><td style="padding:26px 40px;">
                <p class="body-copy" style="margin:0 0 18px;color:#d5e1f1;font-size:15px;line-height:1.7;">Hi ${params.clientName || 'there'}, we received your payment and applied it to your invoice.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#1e3345;border:1px solid #46627f;border-radius:12px;overflow:hidden;margin-bottom:22px;">
                  <tr><td style="padding:11px 18px;border-bottom:1px solid #46627f;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#c2d1e3;">Receipt Details</p></td></tr>
                  <tr><td style="padding:16px 18px 18px;background:#30495f;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:11px;color:#cdd9e8;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Amount Paid</td><td align="right" style="font-size:38px;font-weight:800;color:#ffffff;line-height:1;">${money(params.amountPaid)}</td></tr></table></td></tr>
                  <tr><td style="padding:0 18px;"><div style="height:1px;background:#46627f;"></div></td></tr>
                  <tr><td style="padding:12px 18px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:13px;color:#c2d1e3;font-weight:600;padding-bottom:12px;width:44%;">Paid to Date</td><td align="right" style="font-size:13px;color:#eff6ff;font-weight:700;padding-bottom:12px;">${money(params.paidToDate)}</td></tr></table></td></tr>
                  <tr><td style="padding:0 18px;"><div style="height:1px;background:#46627f;"></div></td></tr>
                  <tr><td style="padding:12px 18px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:13px;color:#c2d1e3;font-weight:600;padding-bottom:12px;width:44%;">Balance</td><td align="right" style="font-size:13px;color:#eff6ff;font-weight:700;padding-bottom:12px;">${money(params.balance)}</td></tr></table></td></tr>
                  ${params.transactionId ? `<tr><td style="padding:0 18px;"><div style="height:1px;background:#46627f;"></div></td></tr><tr><td style="padding:12px 18px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:13px;color:#c2d1e3;font-weight:600;padding-bottom:12px;width:44%;">Transaction ID</td><td align="right" style="font-size:13px;color:#eff6ff;font-weight:700;padding-bottom:12px;">${params.transactionId}</td></tr></table></td></tr>` : ''}
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><a href="${receiptUrl}" style="display:inline-block;padding:16px 48px;font-size:17px;font-weight:700;letter-spacing:0.2px;line-height:1.2;text-decoration:none;text-align:center;border-radius:12px;background:linear-gradient(135deg,#2a5f82 0%,#f0c974 100%);color:#1e2937;">View Receipt</a></td></tr></table>
              </td></tr>
            </table>
          </td></tr>
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
  const emailBranding = await getEmailBranding(params.tenantId)
  const brandLogoUrl = String(emailBranding?.emailLogoUrl || emailBranding?.webLogoUrl || '').trim()
  const headerBrandBlock = brandLogoUrl
    ? `<img src="${brandLogoUrl}" alt="Brand logo" width="200" style="display:inline-block;height:auto;max-height:72px;width:auto;max-width:220px;border:0;margin-bottom:6px;" onerror="this.style.display='none'" />`
    : `<div style="font-size:22px;font-weight:800;color:#f8dea4;">TrimPro</div>`
  const html = `
    <html lang="en">
      <head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <style>
          @media (prefers-color-scheme: light){
            .email-body{ background:#f8f9fc !important; }
            .main-card{ background:#ffffff !important; box-shadow:0 8px 24px rgba(15,23,42,0.08) !important; }
            .headline{ color:#1f2937 !important; }
            .hero-meta{ color:#475569 !important; }
            .body-copy{ color:#1f2937 !important; }
            .status-badge{ background:#e5e7eb !important; color:#111827 !important; border-color:#f8dea4 !important; }
          }
        </style>
      </head>
      <body class="email-body" style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a;padding:24px 12px 40px;">
          <tr><td align="center">
            <table role="presentation" width="580" class="main-card" cellspacing="0" cellpadding="0" style="max-width:580px;width:100%;background:#243f53;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.4);">
              <tr><td style="background:#243f53;padding:34px 36px 26px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.07);">
                ${headerBrandBlock}
                <p style="margin:8px 0 0;font-size:11px;font-weight:600;letter-spacing:2px;color:#f5e3aa;text-transform:uppercase;">Payment Receipt</p>
              </td></tr>
              <tr><td style="padding:30px 40px 22px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.07);">
                <div class="status-badge" style="display:inline-block;background:#334155;border:1px solid #f8dea4;border-radius:999px;padding:5px 16px;margin-bottom:18px;color:#fff;font-size:12px;font-weight:700;">Payment Applied</div>
                <h1 class="headline" style="margin:0 0 10px;font-size:28px;line-height:1.2;font-weight:800;color:#f8dea4;">Bulk Payment Received</h1>
                <p class="hero-meta" style="margin:0;color:#c4d5e9;font-size:13px;font-weight:600;">${params.appliedCount} invoice(s) &bull; ${now.toLocaleString()}</p>
              </td></tr>
              <tr><td style="padding:26px 40px;">
                <p class="body-copy" style="margin:0 0 18px;color:#d5e1f1;font-size:15px;line-height:1.7;">Hi ${params.clientName || 'there'}, your payment was applied to multiple outstanding invoices.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#1e3345;border:1px solid #46627f;border-radius:12px;overflow:hidden;margin-bottom:22px;">
                  <tr><td style="padding:11px 18px;border-bottom:1px solid #46627f;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#c2d1e3;">Receipt Details</p></td></tr>
                  <tr><td style="padding:16px 18px 18px;background:#30495f;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:11px;color:#cdd9e8;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Amount Paid</td><td align="right" style="font-size:38px;font-weight:800;color:#ffffff;line-height:1;">${money(params.amountPaid)}</td></tr></table></td></tr>
                  <tr><td style="padding:0 18px;"><div style="height:1px;background:#46627f;"></div></td></tr>
                  <tr><td style="padding:12px 18px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:13px;color:#c2d1e3;font-weight:600;padding-bottom:12px;width:44%;">Invoices Applied</td><td align="right" style="font-size:13px;color:#eff6ff;font-weight:700;padding-bottom:12px;">${params.appliedCount}</td></tr></table></td></tr>
                  ${params.transactionId ? `<tr><td style="padding:0 18px;"><div style="height:1px;background:#46627f;"></div></td></tr><tr><td style="padding:12px 18px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:13px;color:#c2d1e3;font-weight:600;padding-bottom:12px;width:44%;">Transaction ID</td><td align="right" style="font-size:13px;color:#eff6ff;font-weight:700;padding-bottom:12px;">${params.transactionId}</td></tr></table></td></tr>` : ''}
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:18px;"><tr><td align="center"><a href="https://app.trimprony.com/portal" style="display:inline-block;padding:16px 48px;font-size:17px;font-weight:700;letter-spacing:0.2px;line-height:1.2;text-decoration:none;text-align:center;border-radius:12px;background:linear-gradient(135deg,#2a5f82 0%,#f0c974 100%);color:#1e2937;">View Account</a></td></tr></table>
                <p style="margin:0;color:#d6e3f2;font-size:13px;line-height:1.65;text-align:center;">Questions? Reply to this email and we will help.</p>
              </td></tr>
            </table>
          </td></tr>
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
          const conversion = await getEstimateConversionSummary(tx, estimate.id, estimate.total, invoice.tenantId)
          await tx.estimate.update({
            where: { id: estimate.id },
            data: {
              clientId,
              jobId: createdJob.id,
              status: 'CONVERTED',
              convertedPercent: conversion.convertedPercent,
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

    // xCustom1 carries the intent key when xInvoice is set to human-readable invoice numbers
    const intentRefRaw = String(body?.xCustom1 || body?.xCustom || '')
    const invoiceRefRaw = String(body?.invoiceId || body?.xInvoice || body?.InvoiceID || '')
    // Prefer the explicit intent ref; fall back to xInvoice if it contains the TPINTENT prefix
    const invoiceRef = intentRefRaw.startsWith('TPINTENT:')
      ? intentRefRaw
      : invoiceRefRaw.startsWith('TPINTENT:')
        ? invoiceRefRaw
        : invoiceRefRaw

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
      const plannedAmountsByInvoice =
        resp?.plannedAmountsByInvoice && typeof resp.plannedAmountsByInvoice === 'object'
          ? (resp.plannedAmountsByInvoice as Record<string, any>)
          : null
      const allocationMode = typeof resp?.allocationMode === 'string' ? String(resp.allocationMode) : null
      const maxTotalAmount = resp?.maxTotalAmount != null ? Number(resp.maxTotalAmount) : null
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
      const plannedTotal = plannedAmountsByInvoice
        ? openInvoices.reduce((sum, inv) => sum + Math.max(0, Number(plannedAmountsByInvoice[String(inv.id)] || 0)), 0)
        : 0
      let remaining = paidAmount > 0 ? paidAmount : totalOutstanding
      if (plannedAmountsByInvoice && plannedTotal > 0) {
        remaining = Math.min(remaining, plannedTotal)
      }
      if (allocationMode === 'waterfall' && maxTotalAmount != null && Number.isFinite(maxTotalAmount) && maxTotalAmount > 0) {
        remaining = Math.min(remaining, maxTotalAmount)
      }
      let appliedCount = 0
      let appliedTotal = 0

      for (const inv of openInvoices) {
        if (remaining <= 0) break
        const invBalance = Math.max(0, Number(inv.balance || 0))
        if (invBalance <= 0) continue
        const plannedForThis = plannedAmountsByInvoice ? Number(plannedAmountsByInvoice[String(inv.id)] || 0) : 0
        const maxForThis =
          plannedAmountsByInvoice && plannedForThis > 0
            ? Math.min(invBalance, plannedForThis)
            : invBalance
        const amountForThis = Math.min(remaining, maxForThis)
        if (amountForThis <= 0) continue

        const uniqueTxn = transactionId ? `${transactionId}:${inv.id}` : `BULK:${Date.now()}:${inv.id}`
        const exists = await prisma.payment.findFirst({
          where: { solaTransactionId: uniqueTxn },
          select: { id: true },
        })
        if (exists) continue

        const invoiceRef = inv.invoiceNumber ? `Invoice ${inv.invoiceNumber}` : `Invoice ${inv.id}`
        const createdPayment = await prisma.payment.create({
          data: {
            invoiceId: inv.id,
            amount: amountForThis,
            status: 'COMPLETED',
            method: 'CARD',
            reference: transactionId ? `${transactionId} - ${invoiceRef}` : invoiceRef,
            solaTransactionId: uniqueTxn,
            solaWebhookData: body,
            processedAt: new Date(),
            notes: `Bulk payment for ${invoiceRef}`,
          } as any,
        })

        try {
          await enqueueQboSync(client.tenantId, 'payment', createdPayment.id, { processImmediately: true })
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
          provider: 'sola',
          providerPaymentId: String(transactionId || ''),
          providerInvoiceId: String(invoiceRef || invoice.invoiceNumber || ''),
          reference: transactionId || null,
          solaTransactionId: transactionId || null,
          solaWebhookData: body,
          processedAt: new Date(),
        },
      })

      try {
        await enqueueQboSync(invoice.tenantId, 'payment', createdPayment.id, { processImmediately: true })
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

      if (created && job) {
        // Only notify + QBO-sync when a brand-new job was just created.
        const users = await prisma.user.findMany({
          where: {
            tenantId: invoice.tenantId,
            role: { in: ['ADMIN', 'ACCOUNTING', 'OFFICE', 'OWNER', 'MANAGER'] },
            status: 'ACTIVE',
          },
          select: { id: true },
        })
        if (users.length > 0) {
          const clientName = invoice.client?.name || 'Unknown Client'
          const jobTitle = job.title || `Job ${job.jobNumber || ''}`
          const paymentStatus = newBalance <= 0 ? 'paid in full' : 'partially paid'
          await createNotificationsForUsers(
            invoice.tenantId,
            users.map((u) => u.id),
            {
              type: 'SYSTEM',
              title: 'Job Created From Paid Invoice',
              message: `Invoice #${invoice.invoiceNumber} (${clientName}) was ${paymentStatus}. Job "${jobTitle}" has been automatically created.`,
              linkUrl: `/dashboard/jobs/${job.id}`,
              linkType: 'job',
              linkId: job.id,
              requiresAck: true,
            }
          )
        }
        try {
          await enqueueQboSync(invoice.tenantId, 'job', job.id, { processImmediately: false })
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

