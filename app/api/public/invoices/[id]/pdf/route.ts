import { NextRequest, NextResponse } from 'next/server'
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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const format = request.nextUrl.searchParams.get('format') || 'pdf'
    const wantsHtml = format === 'html'
    const shouldDownload = request.nextUrl.searchParams.get('download') === '1'
    const token = request.nextUrl.searchParams.get('token') || ''
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 })
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: params.id,
        paymentToken: token,
      },
      include: {
        client: true,
        lineItems: {
          orderBy: { sortOrder: 'asc' },
        },
        optionalItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const brand = await getPdfBranding(invoice.tenantId)
    const logoUrl = brand.logoUrl
    const accentColor = brand.accentColor
    const accentTextColor = brand.accentTextColor
    const visibleLineItems = invoice.lineItems.filter((li) => li.isVisibleToClient !== false)
    const visibleOptionalItems = invoice.optionalItems.filter((li) => li.isVisibleToClient !== false)
    const optionalSubtotal = visibleOptionalItems.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
      0
    )

    const rows = visibleLineItems
      .map(
        (li) => `
          <tr>
            <td>${escapeHtml(li.description)}</td>
            <td>${escapeHtml(li.showDescriptionToCustomer === false ? '' : (li.notes || ''))}</td>
            <td style="text-align:right">${Number(li.quantity).toFixed(2)}</td>
            <td style="text-align:right">$${Number(li.unitPrice).toFixed(2)}</td>
            <td style="text-align:right">$${Number(li.total).toFixed(2)}</td>
          </tr>
        `
      )
      .join('')

    const optionalRows = visibleOptionalItems
      .map(
        (li) => `
          <tr>
            <td>${escapeHtml(li.description)}</td>
            <td>${escapeHtml(li.showDescriptionToCustomer === false ? '' : (li.notes || ''))}</td>
            <td style="text-align:right">${Number(li.quantity).toFixed(2)}</td>
            <td style="text-align:right">$${Number(li.unitPrice).toFixed(2)}</td>
            <td style="text-align:right">$${Number(li.total).toFixed(2)}</td>
          </tr>
        `
      )
      .join('')

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Invoice ${invoice.invoiceNumber}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 30px;
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
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        overflow: hidden;
      }
      th, td {
        border-bottom: 1px solid #e5e7eb;
        padding: 10px 12px;
        font-size: 14px;
      }
      th {
        text-align: left;
        background: #f8fafc;
        color: #6b7280;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      tbody tr:nth-child(even) { background: #f9fafb; }
      .summary {
        margin-top: 16px;
        max-width: 320px;
        margin-left: auto;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 14px;
      }
      .summary-row { display: flex; justify-content: space-between; padding: 4px 0; }
      .total {
        font-weight: 700;
        border-top: 1px solid #cbd5e1;
        margin-top: 8px;
        padding-top: 8px;
      }
    </style>
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
          <div class="muted">Generated on ${new Date().toLocaleString()}</div>
        </div>
        <div class="meta">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(brand.businessName)}</div>
          ${brand.businessPhone ? `<div>${escapeHtml(brand.businessPhone)}</div>` : ''}
          ${brand.businessEmail ? `<div>${escapeHtml(brand.businessEmail)}</div>` : ''}
          ${brand.businessAddress ? `<div>${escapeHtml(brand.businessAddress)}</div>` : ''}
          <div style="margin-top:8px;"><strong>No.</strong> ${escapeHtml(invoice.invoiceNumber)}</div>
          <div><strong>Date:</strong> ${escapeHtml(invoice.invoiceDate.toISOString().slice(0, 10))}</div>
          <div><strong>Status:</strong> ${escapeHtml(invoice.status)}</div>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <div><strong>${escapeHtml(invoice.client.name)}</strong></div>
        ${invoice.client.email ? `<div class="muted">${escapeHtml(invoice.client.email)}</div>` : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Description</th>
            <th style="text-align:right">Qty</th>
            <th style="text-align:right">Unit</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      ${
        visibleOptionalItems.length > 0
          ? `
            <div style="margin-top: 20px;">
              <h3 style="margin: 0 0 8px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #6b7280;">Optional Items</h3>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Description</th>
                    <th style="text-align:right">Qty</th>
                    <th style="text-align:right">Unit</th>
                    <th style="text-align:right">Total</th>
                  </tr>
                </thead>
                <tbody>${optionalRows}</tbody>
              </table>
              <div class="summary">
                <div class="summary-row total"><span>Optional Items</span><span>$${optionalSubtotal.toFixed(2)}</span></div>
              </div>
            </div>
          `
          : ''
      }
      <div class="summary">
        <div class="summary-row"><span>Subtotal</span><span>$${Number(invoice.subtotal).toFixed(2)}</span></div>
        <div class="summary-row"><span>Tax</span><span>$${Number(invoice.taxAmount).toFixed(2)}</span></div>
        <div class="summary-row total"><span>Total</span><span>$${Number(invoice.total).toFixed(2)}</span></div>
      </div>
    </div>
  </body>
</html>`

    if (wantsHtml) {
      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
    }

    try {
      const pdf = await renderPdfFromHtml(html)
      return new NextResponse(pdf, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Invoice-${invoice.invoiceNumber}.pdf"`,
        },
      })
    } catch (e) {
      console.error('Public PDF render failed; falling back to HTML:', e)
      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Invoice-${invoice.invoiceNumber}.html"`,
        },
      })
    }
  } catch (error) {
    console.error('Public invoice pdf error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

