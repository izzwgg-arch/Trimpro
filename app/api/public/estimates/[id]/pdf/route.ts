import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
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

function defaultLogoDataUri() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360"><rect width="1200" height="360" fill="#12344d"/><g fill="#f5e7b8" font-family="Inter,Arial,Helvetica,sans-serif"><text x="78" y="238" font-size="182" font-weight="700" letter-spacing="1">TrimPro</text></g><g fill="#ffffff" transform="translate(900,78)"><rect x="0" y="0" width="220" height="24" rx="4"/><rect x="42" y="54" width="36" height="170" rx="3"/><rect x="102" y="54" width="36" height="170" rx="3"/><circle cx="20" cy="84" r="22"/><circle cx="200" cy="84" r="22"/></g></svg>'
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function getPublicLinkSecret(): string {
  const secret = String(process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || '').trim()
  if (!secret) throw new Error('ENCRYPTION_KEY (or NEXTAUTH_SECRET) is required for public estimate PDF links')
  return secret
}

function timingSafeEqualHex(a: string, b: string) {
  // Normalize length to avoid throwing on timingSafeEqual.
  const aa = Buffer.from(String(a || ''), 'hex')
  const bb = Buffer.from(String(b || ''), 'hex')
  if (aa.length !== bb.length) return false
  return crypto.timingSafeEqual(aa, bb)
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const format = request.nextUrl.searchParams.get('format') || 'pdf'
    const wantsHtml = format === 'html'
    const shouldDownload = request.nextUrl.searchParams.get('download') === '1'
    const sentRaw = request.nextUrl.searchParams.get('sent') || ''
    const sig = request.nextUrl.searchParams.get('sig') || ''

    const sent = Number(sentRaw)
    if (!Number.isFinite(sent) || sent <= 0) {
      return NextResponse.json({ error: 'Missing sent timestamp' }, { status: 401 })
    }
    if (!sig) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    // Allow links for up to ~1 year.
    const maxAgeMs = 1000 * 60 * 60 * 24 * 365
    if (Math.abs(Date.now() - sent) > maxAgeMs) {
      return NextResponse.json({ error: 'Link expired' }, { status: 401 })
    }

    const secret = getPublicLinkSecret()
    const expected = crypto.createHmac('sha256', secret).update(`${params.id}.${sent}`).digest('hex')
    if (!timingSafeEqualHex(sig, expected)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const estimate = await prisma.estimate.findFirst({
      where: { id: params.id },
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

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    const logoUrl = process.env.PDF_LOGO_URL || process.env.NEXT_PUBLIC_PDF_LOGO_URL || defaultLogoDataUri()
    const visibleLineItems = estimate.lineItems.filter((li) => li.isVisibleToClient !== false)
    const visibleOptionalItems = estimate.optionalItems.filter((li) => li.isVisibleToClient !== false)
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
    <title>Estimate ${escapeHtml(estimate.estimateNumber)}</title>
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
                ? `<img class="logo-image" src="${escapeHtml(String(logoUrl))}" alt="Trim Pro Logo" />`
                : `<div class="logo-fallback">trimpro</div>`
            }
          </div>
          <h1 class="doc-title">Estimate</h1>
          <div class="muted">Generated on ${new Date().toLocaleString()}</div>
        </div>
        <div class="meta">
          <div><strong>No.</strong> ${escapeHtml(estimate.estimateNumber)}</div>
          <div><strong>Status:</strong> ${escapeHtml(estimate.status)}</div>
          ${estimate.validUntil ? `<div><strong>Valid until:</strong> ${escapeHtml(estimate.validUntil.toISOString().slice(0, 10))}</div>` : ''}
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <div><strong>${escapeHtml(estimate.client?.name || 'Client')}</strong></div>
        ${estimate.client?.email ? `<div class="muted">${escapeHtml(estimate.client.email)}</div>` : ''}
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
        <div class="summary-row"><span>Subtotal</span><span>$${Number(estimate.subtotal).toFixed(2)}</span></div>
        <div class="summary-row"><span>Tax</span><span>$${Number(estimate.taxAmount || 0).toFixed(2)}</span></div>
        <div class="summary-row total"><span>Total</span><span>$${Number(estimate.total).toFixed(2)}</span></div>
      </div>
    </div>
  </body>
</html>`

    if (wantsHtml) {
      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      })
    }

    try {
      const pdf = await renderPdfFromHtml(html)
      return new NextResponse(pdf, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Estimate-${estimate.estimateNumber}.pdf"`,
        },
      })
    } catch (e) {
      console.error('Public PDF render failed; falling back to HTML:', e)
      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Estimate-${estimate.estimateNumber}.html"`,
        },
      })
    }
  } catch (error) {
    console.error('Public estimate pdf error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

