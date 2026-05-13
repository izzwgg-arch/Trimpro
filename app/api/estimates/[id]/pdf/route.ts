import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'
import { getPdfBranding } from '@/lib/branding/pdf'
import { calculateOrderedSubtotalRows, mergeApprovedOptionalItemsForSubtotals } from '@/lib/documents/subtotals'

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

    const estimate = await prisma.estimate.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            companyName: true,
            email: true,
            phone: true,
          },
        },
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

    // Fetch approvals so approved optional items are merged into the main line items section
    const itemApprovals = await prisma.estimateItemApproval.findMany({
      where: { estimateId: estimate.id, tenantId: user.tenantId, status: 'APPROVED' },
      select: { estimateLineItemId: true },
    })
    const approvedIdSet = new Set(itemApprovals.map((a) => a.estimateLineItemId))

    const visibleRegularItems = estimate.lineItems.filter((item) => item.isVisibleToClient !== false)
    const allVisibleOptionalItems = estimate.optionalItems.filter((item) => item.isVisibleToClient !== false)
    // Approved optional items become regular line items; only pending ones show as optional
    const approvedOptionalItems = allVisibleOptionalItems.filter((li) => approvedIdSet.has(li.id))
    const pendingOptionalItems = allVisibleOptionalItems.filter((li) => !approvedIdSet.has(li.id))
    const visibleItems = calculateOrderedSubtotalRows(
      mergeApprovedOptionalItemsForSubtotals(visibleRegularItems as any[], approvedOptionalItems as any[])
    )
    const visibleOptionalItems = pendingOptionalItems

    const regularSubtotal = visibleRegularItems.reduce((sum, item) => {
      return sum + Number(item.quantity) * Number(item.unitPrice)
    }, 0)
    const approvedOptionalSubtotal = approvedOptionalItems.reduce((sum, item) => {
      return sum + Number(item.quantity) * Number(item.unitPrice)
    }, 0)
    const subtotal = regularSubtotal + approvedOptionalSubtotal
    const optionalSubtotal = pendingOptionalItems.reduce((sum, item) => {
      return sum + Number(item.quantity) * Number(item.unitPrice)
    }, 0)

    // Column visibility — respect per-field flags
    const showNameCol = visibleItems.some((li) => li.showDescriptionToCustomer !== false) ||
      visibleOptionalItems.some((li) => li.showDescriptionToCustomer !== false)
    const showNotesCol = visibleItems.some((li) => li.showNotesToCustomer !== false) ||
      visibleOptionalItems.some((li) => li.showNotesToCustomer !== false)
    const showCostCol = visibleItems.some((li) => li.showCostToCustomer === true) ||
      visibleOptionalItems.some((li) => li.showCostToCustomer === true)
    const showPriceCol = visibleItems.some((li) => li.showPriceToCustomer !== false) ||
      visibleOptionalItems.some((li) => li.showPriceToCustomer !== false)

    const buildRow = (item: typeof visibleItems[0]) => {
      if (item.isSubtotal) {
        const colSpan = (showNameCol ? 1 : 0) + (showNotesCol ? 1 : 0) + 1 + (showCostCol ? 1 : 0) + (showPriceCol ? 1 : 0)
        return `<tr style="background:#f8fafc;font-weight:700;">
          <td colspan="${colSpan}" style="text-align:right">Subtotal</td>
          <td class="text-right">$${Number(item.calculatedSubtotalTotal).toFixed(2)}</td>
        </tr>`
      }
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
    const discount = Number(estimate.discount || 0)
    const taxRate = Number(estimate.taxRate || 0)
    const subtotalAfterDiscount = subtotal - discount
    const tax = subtotalAfterDiscount * taxRate
    const total = subtotalAfterDiscount + tax

    const showNotes = estimate.isNotesVisibleToClient !== false && Boolean(estimate.notes)
    const generatedAt = new Date().toLocaleString()
    const clientName = estimate.client?.companyName || estimate.client?.name || 'N/A'
    const validUntil = estimate.validUntil ? new Date(estimate.validUntil).toLocaleDateString() : 'N/A'
    const estimateDate = new Date(estimate.createdAt).toLocaleDateString()
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Estimate ${estimate.estimateNumber}</title>
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
            }
            .section { margin-top: 20px; }
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
                <h1 class="doc-title">Estimate</h1>
                <div class="muted">Generated on ${generatedAt}</div>
              </div>
              <div class="meta">
                <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(brand.businessName)}</div>
                ${brand.businessPhone ? `<div>${escapeHtml(brand.businessPhone)}</div>` : ''}
                ${brand.businessEmail ? `<div>${escapeHtml(brand.businessEmail)}</div>` : ''}
                ${brand.businessAddress ? `<div>${escapeHtml(brand.businessAddress)}</div>` : ''}
                <div style="margin-top:8px;"><strong>No.</strong> ${escapeHtml(estimate.estimateNumber)}</div>
                <div><strong>Status:</strong> ${escapeHtml(estimate.status)}</div>
                <div><strong>Valid Until:</strong> ${escapeHtml(validUntil)}</div>
              </div>
            </div>

            <div class="grid">
              <div class="panel">
                <h3>Prepared For</h3>
                <div>${escapeHtml(clientName)}</div>
                ${estimate.client?.email ? `<div class="muted">${escapeHtml(estimate.client.email)}</div>` : ''}
                ${estimate.client?.phone ? `<div class="muted">${escapeHtml(estimate.client.phone)}</div>` : ''}
              </div>
              <div class="panel">
                <h3>Document Details</h3>
                <div class="muted">Estimate Date</div>
                <div>${estimateDate}</div>
                <div class="muted" style="margin-top:8px;">Reference</div>
                <div>${escapeHtml(estimate.title || estimate.estimateNumber)}</div>
              </div>
            </div>

            <table>
              <thead>${tableHeader}</thead>
              <tbody>
                ${
                  visibleItems.length === 0
                    ? `<tr><td colspan="6" class="muted">No visible items</td></tr>`
                    : visibleItems.map(buildRow).join('')
                }
              </tbody>
            </table>

            ${
              visibleOptionalItems.length > 0
                ? `
                  <div class="section">
                    <h3>Optional Items</h3>
                    <table>
                      <thead>${tableHeader}</thead>
                      <tbody>
                        ${visibleOptionalItems.map(buildRow).join('')}
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
              <div class="summary-row total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
            </div>

            ${showNotes ? `
              <div class="section">
                <h3>Notes</h3>
                <div class="notes">${escapeHtml(estimate.notes || '')}</div>
              </div>
            ` : ''}

            ${estimate.terms ? `
              <div class="section">
                <h3>Terms & Conditions</h3>
                <div class="notes">${escapeHtml(estimate.terms)}</div>
              </div>
            ` : ''}

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
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Estimate-${estimate.estimateNumber}.html"`,
        },
      })
    }

    try {
      const pdf = await renderPdfFromHtml(html)
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Estimate-${estimate.estimateNumber}.pdf"`,
        },
      })
    } catch (e) {
      console.error('PDF render failed; falling back to HTML:', e)
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="Estimate-${estimate.estimateNumber}.html"`,
        },
      })
    }
  } catch (error) {
    console.error('Generate estimate PDF error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
