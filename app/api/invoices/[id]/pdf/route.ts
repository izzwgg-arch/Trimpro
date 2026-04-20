import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'
import { getPdfBranding } from '@/lib/branding/pdf'

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
    const brand = await getPdfBranding(user.tenantId)
    const logoUrl = brand.logoUrl
    const accentColor = brand.accentColor
    const accentTextColor = brand.accentTextColor

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

    const visibleRegularItems = invoice.lineItems.filter((item) => item.isVisibleToClient !== false)
    const visibleOptionalItems = invoice.optionalItems.filter((item) => item.isVisibleToClient !== false)
    // Merge optional items into the main items — all items on an invoice are being billed
    const visibleLineItems = [...visibleRegularItems, ...visibleOptionalItems]
    const subtotal = visibleLineItems.reduce((sum, item) => {
      return sum + Number(item.quantity) * Number(item.unitPrice)
    }, 0)
    const optionalSubtotal = 0 // No longer shown separately — merged into main total

    // Column visibility — respect per-field flags so admin PDF matches customer view
    const showNameCol = visibleLineItems.some((li) => li.showDescriptionToCustomer !== false) ||
      visibleOptionalItems.some((li) => li.showDescriptionToCustomer !== false)
    const showNotesCol = visibleLineItems.some((li) => li.showNotesToCustomer !== false) ||
      visibleOptionalItems.some((li) => li.showNotesToCustomer !== false)
    const showCostCol = visibleLineItems.some((li) => li.showCostToCustomer === true) ||
      visibleOptionalItems.some((li) => li.showCostToCustomer === true)
    const showPriceCol = visibleLineItems.some((li) => li.showPriceToCustomer !== false) ||
      visibleOptionalItems.some((li) => li.showPriceToCustomer !== false)

    const buildRow = (item: typeof visibleLineItems[0]) => {
      const nameCell = item.showDescriptionToCustomer !== false ? escapeHtml(item.description) : ''
      const notesCell = item.showNotesToCustomer !== false ? escapeHtml(item.notes || '') : ''
      const costCell = item.showCostToCustomer === true ? `$${Number((item as any).unitCost || 0).toFixed(2)}` : ''
      const priceCell = item.showPriceToCustomer !== false ? `$${Number(item.unitPrice).toFixed(2)}` : ''
      return `<tr>
        ${showNameCol ? `<td>${nameCell}</td>` : ''}
        ${showNotesCol ? `<td>${notesCell}</td>` : ''}
        <td class="text-right">${Number(item.quantity).toFixed(2)}</td>
        ${showCostCol ? `<td class="text-right">${costCell}</td>` : ''}
        ${showPriceCol ? `<td class="text-right">${priceCell}</td>` : ''}
        <td class="text-right">$${Number(item.total).toFixed(2)}</td>
      </tr>`
    }

    const tableHeader = `<tr>
      ${showNameCol ? '<th>Item</th>' : ''}
      ${showNotesCol ? '<th>Description</th>' : ''}
      <th class="text-right">Qty</th>
      ${showCostCol ? '<th class="text-right">Cost</th>' : ''}
      ${showPriceCol ? '<th class="text-right">Unit Price</th>' : ''}
      <th class="text-right">Total</th>
    </tr>`

    const discount = Number(invoice.discount || 0)
    const tax = Number(invoice.taxAmount || 0)
    const optItemsSubtotal = visibleOptionalItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0)
    const total = Number(invoice.total || 0) + optItemsSubtotal
    const balance = Number(invoice.balance || 0) + optItemsSubtotal
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
              background: ${accentColor};
              color: ${accentTextColor};
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
                <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(brand.businessName)}</div>
                ${brand.businessPhone ? `<div>${escapeHtml(brand.businessPhone)}</div>` : ''}
                ${brand.businessEmail ? `<div>${escapeHtml(brand.businessEmail)}</div>` : ''}
                ${brand.businessAddress ? `<div>${escapeHtml(brand.businessAddress)}</div>` : ''}
                <div style="margin-top:8px;"><strong>No.</strong> ${escapeHtml(invoice.invoiceNumber)}</div>
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
              <thead>${tableHeader}</thead>
              <tbody>
                ${visibleLineItems.length === 0
                  ? `<tr><td colspan="6" class="muted">No visible items</td></tr>`
                  : visibleLineItems.map(buildRow).join('')}
              </tbody>
            </table>


            <div class="summary">
              <h4>Summary</h4>
              <div class="summary-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
              <div class="summary-row"><span>Discount</span><span>-$${discount.toFixed(2)}</span></div>
              <div class="summary-row"><span>Tax</span><span>$${tax.toFixed(2)}</span></div>
              <div class="summary-row"><span>Paid</span><span>$${paid.toFixed(2)}</span></div>
              <div class="summary-row total"><span>Balance Due</span><span>$${balance.toFixed(2)}</span></div>
            </div>

            ${showNotes ? `<div class="notes">${escapeHtml(invoice.notes!)}</div>` : ''}

            ${brand.footerText ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">${escapeHtml(brand.footerText)}</div>` : ''}

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
