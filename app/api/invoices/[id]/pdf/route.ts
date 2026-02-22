import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { solaService } from '@/lib/services/sola'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'

export const runtime = 'nodejs'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatAddress(address: {
  street: string
  city: string
  state: string
  zipCode: string
} | null | undefined): string | null {
  if (!address) return null
  const parts = [address.street, address.city, `${address.state} ${address.zipCode}`]
    .map((p) => (p || '').trim())
    .filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

function defaultLogoDataUri() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360"><rect width="1200" height="360" fill="#12344d"/><g fill="#f5e7b8" font-family="Inter,Arial,Helvetica,sans-serif"><text x="78" y="238" font-size="182" font-weight="700" letter-spacing="1">TrimPro</text></g><g fill="#ffffff" transform="translate(900,78)"><rect x="0" y="0" width="220" height="24" rx="4"/><rect x="42" y="54" width="36" height="170" rx="3"/><rect x="102" y="54" width="36" height="170" rx="3"/><circle cx="20" cy="84" r="22"/><circle cx="200" cy="84" r="22"/></g></svg>'
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const shouldPrint = request.nextUrl.searchParams.get('print') === '1'
    const shouldDownload = request.nextUrl.searchParams.get('download') === '1'
    const format = request.nextUrl.searchParams.get('format') || 'pdf'
    const wantsHtml = format === 'html'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || request.nextUrl.origin
    const logoUrl = process.env.PDF_LOGO_URL || process.env.NEXT_PUBLIC_PDF_LOGO_URL || defaultLogoDataUri()

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
        optionalItems: {
          orderBy: { sortOrder: 'asc' },
        },
        job: {
          select: {
            id: true,
            jobNumber: true,
            title: true,
            addresses: {
              where: { type: 'job_site' },
              take: 1,
            },
          },
        },
        estimate: {
          select: {
            jobSiteAddress: true,
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const subtotal = invoice.lineItems.reduce((sum, item) => {
      return sum + Number(item.quantity) * Number(item.unitPrice)
    }, 0)
    const visibleOptionalItems = invoice.optionalItems.filter((item) => item.isVisibleToClient !== false)
    const optionalSubtotal = visibleOptionalItems.reduce((sum, item) => {
      return sum + Number(item.quantity) * Number(item.unitPrice)
    }, 0)
    const discount = Number(invoice.discount || 0)
    const tax = Number(invoice.taxAmount || 0)
    const total = Number(invoice.total || 0)
    const balance = Number(invoice.balance || 0)
    const paid = Number(invoice.paidAmount || 0)
    const showNotes = invoice.isNotesVisibleToClient !== false && Boolean(invoice.notes)
    const generatedAt = new Date().toLocaleString()
    const invoiceDate = invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : new Date().toLocaleDateString()
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'
    const clientName = invoice.client?.companyName || invoice.client?.name || 'N/A'
    const primaryContact = invoice.client?.contacts?.[0] || null
    const jobSiteAddress =
      formatAddress(invoice.job?.addresses?.[0]) ||
      (invoice.estimate?.jobSiteAddress ? String(invoice.estimate.jobSiteAddress) : null)

    let paymentLink = `${appUrl}/portal/pay/${invoice.id}?token=${invoice.paymentToken || ''}`
    if (balance > 0) {
      try {
        const solaSecrets = await getIntegrationSecrets(user.tenantId, 'sola')
        if (!solaSecrets?.secretKey) {
          throw new Error('Sola integration is not configured (missing secret key).')
        }
        const link = await solaService.createPaymentLink({
          invoiceId: invoice.id,
          amount: balance,
          description: `Invoice ${invoice.invoiceNumber} - ${invoice.title}`,
          clientEmail: invoice.client?.email || primaryContact?.email || undefined,
          clientName: invoice.client?.name || undefined,
          returnUrl: `${appUrl}/portal/pay/${invoice.id}?token=${invoice.paymentToken || ''}`,
          webhookUrl: `${appUrl}/api/webhooks/sola-payment`,
          apiKey: solaSecrets.secretKey,
        })
        paymentLink = link.url || `${appUrl}/portal/pay/${invoice.id}?token=${invoice.paymentToken || ''}`
      } catch (error) {
        console.error('Invoice PDF payment link error:', error)
      }
    }

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Invoice ${invoice.invoiceNumber}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              padding: 32px;
              font-family: Inter, Helvetica, Arial, sans-serif;
              color: #111827;
              background: #f8fafc;
            }
            .page {
              max-width: 980px;
              margin: 0 auto;
              background: #fff;
              border: 1px solid #e5e7eb;
              border-radius: 14px;
              padding: 28px;
            }
            .header {
              display: grid;
              grid-template-columns: 1fr auto;
              gap: 20px;
              align-items: start;
              margin-bottom: 24px;
            }
            .brand { display: flex; align-items: center; gap: 12px; }
            .logo-image {
              height: 56px;
              width: auto;
              max-width: 300px;
              object-fit: contain;
              display: block;
            }
            .logo-fallback {
              height: 56px;
              min-width: 160px;
              border-radius: 10px;
              background: #12344d;
              color: #f5e7b8;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 28px;
              font-weight: 700;
              letter-spacing: 0.02em;
              padding: 0 18px;
            }
            .doc-title {
              margin: 12px 0 0;
              font-size: 30px;
              font-weight: 700;
              letter-spacing: -0.02em;
            }
            .muted { color: #6b7280; font-size: 12px; }
            .meta {
              text-align: right;
              font-size: 13px;
              color: #374151;
              line-height: 1.7;
            }
            .grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 16px;
              margin-bottom: 22px;
            }
            .panel {
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              padding: 14px;
              background: #ffffff;
            }
            .panel h3 {
              margin: 0 0 8px;
              font-size: 12px;
              letter-spacing: 0.06em;
              text-transform: uppercase;
              color: #6b7280;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              overflow: hidden;
            }
            th, td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
            th {
              text-align: left;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.06em;
              color: #6b7280;
              background: #f8fafc;
            }
            tbody tr:nth-child(even) { background: #f9fafb; }
            td.text-right, th.text-right { text-align: right; }
            .summary {
              margin-top: 16px;
              margin-left: auto;
              width: 320px;
              background: #f3f4f6;
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              padding: 14px;
            }
            .summary h4 {
              margin: 0 0 10px;
              font-size: 12px;
              letter-spacing: 0.06em;
              text-transform: uppercase;
              color: #6b7280;
            }
            .summary-row {
              display: flex;
              justify-content: space-between;
              padding: 5px 0;
              font-size: 14px;
            }
            .summary-row.total {
              margin-top: 6px;
              padding-top: 8px;
              border-top: 1px solid #cbd5e1;
              font-size: 18px;
              font-weight: 700;
            }
            .pay-online {
              margin-top: 24px;
              border: 1px solid #dbeafe;
              background: #eff6ff;
              border-radius: 10px;
              padding: 14px;
            }
            .pay-online h4 {
              margin: 0 0 8px;
              color: #1d4ed8;
              font-size: 14px;
            }
            .pay-button {
              display: inline-block;
              margin-top: 10px;
              text-decoration: none;
              background: #2563eb;
              color: #fff;
              border-radius: 8px;
              padding: 10px 14px;
              font-size: 13px;
              font-weight: 600;
            }
            .qr-placeholder {
              margin-top: 10px;
              width: 72px;
              height: 72px;
              border: 1px dashed #93c5fd;
              border-radius: 8px;
              color: #60a5fa;
              font-size: 10px;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .notes {
              white-space: pre-wrap;
              background: #f8fafc;
              border: 1px solid #e5e7eb;
              padding: 12px;
              border-radius: 10px;
              line-height: 1.5;
              margin-top: 20px;
            }
            @media print {
              body { background: #fff; padding: 0; }
              .page { border: none; border-radius: 0; }
            }
          </style>
          ${shouldPrint ? '<script>window.addEventListener("load", () => window.print());</script>' : ''}
        </head>
        <body>
          <div class="page">
            <div class="header">
              <div>
                <div class="brand">
                  ${
                    logoUrl
                      ? `<img class="logo-image" src="${escapeHtml(logoUrl)}" alt="Trim Pro Logo" />`
                      : `<div class="logo-fallback">trimpro</div>`
                  }
                </div>
                <h1 class="doc-title">Invoice</h1>
                <div class="muted">Generated on ${generatedAt}</div>
              </div>
              <div class="meta">
                <div><strong>No.</strong> ${escapeHtml(invoice.invoiceNumber)}</div>
                <div><strong>Invoice Date:</strong> ${escapeHtml(invoiceDate)}</div>
                <div><strong>Due Date:</strong> ${escapeHtml(dueDate)}</div>
                <div><strong>Status:</strong> ${escapeHtml(invoice.status)}</div>
              </div>
            </div>

            <div class="grid">
              <div class="panel">
                <h3>Billed To</h3>
                <div>${escapeHtml(clientName)}</div>
                ${invoice.client?.email ? `<div class="muted">${escapeHtml(invoice.client.email)}</div>` : ''}
                ${primaryContact?.email ? `<div class="muted">${escapeHtml(primaryContact.email)}</div>` : ''}
                ${primaryContact?.phone ? `<div class="muted">${escapeHtml(primaryContact.phone)}</div>` : ''}
              </div>
              <div class="panel">
                <h3>Document Details</h3>
                <div class="muted">Reference</div>
                <div>${escapeHtml(invoice.title || invoice.invoiceNumber)}</div>
                ${
                  invoice.job
                    ? `<div class="muted" style="margin-top:8px;">Job</div><div>${escapeHtml(invoice.job.jobNumber)} - ${escapeHtml(invoice.job.title)}</div>`
                    : ''
                }
                ${
                  jobSiteAddress
                    ? `<div class="muted" style="margin-top:8px;">Job Address</div><div>${escapeHtml(jobSiteAddress)}</div>`
                    : ''
                }
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Description</th>
                  <th class="text-right">Qty</th>
                  <th class="text-right">Unit Price</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${invoice.lineItems.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.description)}</td>
                    <td>${escapeHtml(item.showDescriptionToCustomer === false ? '' : (item.notes || ''))}</td>
                    <td class="text-right">${Number(item.quantity).toFixed(2)}</td>
                    <td class="text-right">$${Number(item.unitPrice).toFixed(2)}</td>
                    <td class="text-right">$${Number(item.total).toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            ${
              visibleOptionalItems.length > 0
                ? `
                  <div class="section">
                    <h3>Optional Items</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Description</th>
                          <th class="text-right">Qty</th>
                          <th class="text-right">Unit</th>
                          <th class="text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${visibleOptionalItems
                          .map(
                            (item) => `
                              <tr>
                                <td>${escapeHtml(item.description)}</td>
                                <td>${escapeHtml(item.showDescriptionToCustomer === false ? '' : (item.notes || ''))}</td>
                                <td class="text-right">${Number(item.quantity).toFixed(2)}</td>
                                <td class="text-right">$${Number(item.unitPrice).toFixed(2)}</td>
                                <td class="text-right">$${Number(item.total).toFixed(2)}</td>
                              </tr>
                            `
                          )
                          .join('')}
                      </tbody>
                    </table>
                    <div class="summary" style="margin-top:12px; width: 320px;">
                      <h4>Optional Subtotal</h4>
                      <div class="summary-row total"><span>Optional Items</span><span>$${optionalSubtotal.toFixed(2)}</span></div>
                    </div>
                  </div>
                `
                : ''
            }

            <div class="summary">
              <h4>Summary</h4>
              <div class="summary-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
              <div class="summary-row"><span>Discount</span><span>-$${discount.toFixed(2)}</span></div>
              <div class="summary-row"><span>Tax</span><span>$${tax.toFixed(2)}</span></div>
              <div class="summary-row"><span>Paid</span><span>$${paid.toFixed(2)}</span></div>
              <div class="summary-row total"><span>Balance Due</span><span>$${balance.toFixed(2)}</span></div>
            </div>

            ${showNotes ? `<div class="notes">${escapeHtml(invoice.notes!)}</div>` : ''}

            <div class="pay-online">
              <h4>Pay Online</h4>
              <div class="muted">Use the secure payment link below to pay this invoice online.</div>
              <a class="pay-button" href="${escapeHtml(paymentLink)}">Pay Now</a>
              <div class="muted" style="margin-top:8px; word-break: break-all;">${escapeHtml(paymentLink)}</div>
              <div class="qr-placeholder">QR</div>
            </div>
          </div>
        </body>
      </html>
    `

    if (wantsHtml) {
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Invoice-${invoice.invoiceNumber}.html"`,
        },
      })
    }

    try {
      const pdf = await renderPdfFromHtml(html)
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Invoice-${invoice.invoiceNumber}.pdf"`,
        },
      })
    } catch (e) {
      console.error('PDF render failed; falling back to HTML:', e)
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Invoice-${invoice.invoiceNumber}.html"`,
        },
      })
    }
  } catch (error) {
    console.error('Generate invoice PDF error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
