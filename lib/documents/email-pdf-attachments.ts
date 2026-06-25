import { calculateOrderedSubtotalRows, mergeApprovedOptionalItemsForSubtotals } from '@/lib/documents/subtotals'
import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'

type AnyRecord = Record<string, any>

export interface PdfEmailAttachment {
  filename: string
  content: Buffer
  contentType: 'application/pdf'
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeFilenamePart(value: unknown, fallback: string) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || fallback
}

function dateOnly(value: unknown) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function buildBrandHeader(brand: AnyRecord, logoAlt: string) {
  return `
    <div class="brand">
      ${
        brand.logoUrl
          ? `<img class="logo-image" src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(logoAlt)}" />`
          : '<div class="logo-fallback">trimpro</div>'
      }
    </div>
  `
}

function buildDocumentCss(brand: AnyRecord) {
  const accentColor = brand.accentColor || '#12344d'
  const accentTextColor = brand.accentTextColor || '#ffffff'

  return `
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
  `
}

export function buildInvoiceEmailPdfHtml(invoice: AnyRecord, brand: AnyRecord) {
  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : []
  const optionalItems = Array.isArray(invoice.optionalItems) ? invoice.optionalItems : []
  const visibleRegularItems = calculateOrderedSubtotalRows(lineItems.filter((li) => li.isVisibleToClient !== false) as any[])
  const visibleOptionalItems = optionalItems.filter((li) => li.isVisibleToClient !== false)
  const visibleLineItems = [...visibleRegularItems, ...visibleOptionalItems]
  const optionalSubtotal = visibleOptionalItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
    0
  )

  const showPriceCol = visibleLineItems.some((li) => li.showPriceToCustomer !== false)
  const showCostCol = visibleLineItems.some((li) => li.showCostToCustomer === true)
  const showNotesCol = visibleLineItems.some((li) => li.showNotesToCustomer !== false)
  const showTaxRow =
    visibleLineItems.some((li) => li.showTaxToCustomer !== false) || visibleLineItems.length === 0

  function tableHeader() {
    return `
      <tr>
        <th>Item</th>
        ${showNotesCol ? '<th>Description</th>' : ''}
        <th style="text-align:right">Qty</th>
        ${showCostCol ? '<th style="text-align:right">Cost</th>' : ''}
        ${showPriceCol ? '<th style="text-align:right">Unit</th>' : ''}
        <th style="text-align:right">Total</th>
      </tr>
    `
  }

  function buildRow(li: AnyRecord) {
    if (li.isSubtotal) {
      const colSpan = 1 + (showNotesCol ? 1 : 0) + 1 + (showCostCol ? 1 : 0) + (showPriceCol ? 1 : 0)
      return `
        <tr style="background:#f8fafc;font-weight:700;">
          <td colspan="${colSpan}" style="text-align:right">Subtotal</td>
          <td style="text-align:right">$${Number(li.calculatedSubtotalTotal).toFixed(2)}</td>
        </tr>
      `
    }

    return `
      <tr>
        <td>${li.showDescriptionToCustomer !== false ? escapeHtml(li.description) : ''}</td>
        ${showNotesCol ? `<td>${escapeHtml(li.showNotesToCustomer === false ? '' : li.notes || '')}</td>` : ''}
        <td style="text-align:right">${Number(li.quantity).toFixed(2)}</td>
        ${showCostCol ? `<td style="text-align:right">${li.showCostToCustomer === true ? '$' + Number(li.unitCost || 0).toFixed(2) : ''}</td>` : ''}
        ${showPriceCol ? `<td style="text-align:right">${li.showPriceToCustomer !== false ? '$' + Number(li.unitPrice).toFixed(2) : ''}</td>` : ''}
        <td style="text-align:right">$${Number(li.total).toFixed(2)}</td>
      </tr>
    `
  }

  const rows = visibleLineItems.length
    ? visibleLineItems.map(buildRow).join('')
    : `<tr><td colspan="${3 + (showNotesCol ? 1 : 0) + (showCostCol ? 1 : 0) + (showPriceCol ? 1 : 0)}" class="muted">No visible items</td></tr>`
  const client = invoice.client || {}
  const invoiceDate = dateOnly(invoice.invoiceDate) || new Date().toISOString().slice(0, 10)

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
    <style>${buildDocumentCss(brand)}</style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div>
          ${buildBrandHeader(brand, 'Trim Pro Logo')}
          <h1 class="doc-title">Invoice</h1>
          <div class="muted">Generated on ${escapeHtml(new Date().toLocaleString())}</div>
        </div>
        <div class="meta">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(brand.businessName || 'TrimPro')}</div>
          ${brand.businessPhone ? `<div>${escapeHtml(brand.businessPhone)}</div>` : ''}
          ${brand.businessEmail ? `<div>${escapeHtml(brand.businessEmail)}</div>` : ''}
          ${brand.businessAddress ? `<div>${escapeHtml(brand.businessAddress)}</div>` : ''}
          <div style="margin-top:8px;"><strong>No.</strong> ${escapeHtml(invoice.invoiceNumber)}</div>
          <div><strong>Date:</strong> ${escapeHtml(invoiceDate)}</div>
          <div><strong>Status:</strong> ${escapeHtml(invoice.status)}</div>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <div><strong>${escapeHtml(client.companyName || client.name || 'Client')}</strong></div>
        ${client.email ? `<div class="muted">${escapeHtml(client.email)}</div>` : ''}
      </div>

      <table>
        <thead>${tableHeader()}</thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="summary">
        <div class="summary-row"><span>Subtotal</span><span>$${(Number(invoice.subtotal || 0) + optionalSubtotal).toFixed(2)}</span></div>
        ${showTaxRow ? `<div class="summary-row"><span>Tax</span><span>$${Number(invoice.taxAmount || 0).toFixed(2)}</span></div>` : ''}
        <div class="summary-row total"><span>Total</span><span>$${(Number(invoice.total || 0) + optionalSubtotal).toFixed(2)}</span></div>
      </div>
    </div>
  </body>
</html>`
}

export function buildEstimateEmailPdfHtml(
  estimate: AnyRecord,
  brand: AnyRecord,
  approvedOptionalItemIds: Set<string> = new Set()
) {
  const lineItems = Array.isArray(estimate.lineItems) ? estimate.lineItems : []
  const optionalItems = Array.isArray(estimate.optionalItems) ? estimate.optionalItems : []
  const visibleLineItems = lineItems.filter((li) => li.isVisibleToClient !== false)
  const allVisibleOptionalItems = optionalItems.filter((li) => li.isVisibleToClient !== false)
  const approvedOptionalItems = allVisibleOptionalItems.filter((li) => approvedOptionalItemIds.has(li.id))
  const pendingOptionalItems = allVisibleOptionalItems.filter((li) => !approvedOptionalItemIds.has(li.id))
  const mainItems = calculateOrderedSubtotalRows(
    mergeApprovedOptionalItemsForSubtotals(visibleLineItems as any[], approvedOptionalItems as any[])
  )
  const optionalSubtotal = pendingOptionalItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
    0
  )

  const showPriceCol =
    mainItems.some((li) => li.showPriceToCustomer !== false) ||
    pendingOptionalItems.some((li) => li.showPriceToCustomer !== false)
  const showCostCol =
    mainItems.some((li) => li.showCostToCustomer === true) ||
    pendingOptionalItems.some((li) => li.showCostToCustomer === true)
  const showNotesCol =
    mainItems.some((li) => li.showNotesToCustomer !== false) ||
    pendingOptionalItems.some((li) => li.showNotesToCustomer !== false)
  const showTaxRow =
    mainItems.some((li) => li.showTaxToCustomer !== false) ||
    pendingOptionalItems.some((li) => li.showTaxToCustomer !== false) ||
    (mainItems.length === 0 && pendingOptionalItems.length === 0)

  function tableHeader() {
    return `
      <tr>
        <th>Item</th>
        ${showNotesCol ? '<th>Description</th>' : ''}
        <th style="text-align:right">Qty</th>
        ${showCostCol ? '<th style="text-align:right">Cost</th>' : ''}
        ${showPriceCol ? '<th style="text-align:right">Unit</th>' : ''}
        <th style="text-align:right">Total</th>
      </tr>
    `
  }

  function buildRow(li: AnyRecord) {
    if (li.isSubtotal) {
      const colSpan = 1 + (showNotesCol ? 1 : 0) + 1 + (showCostCol ? 1 : 0) + (showPriceCol ? 1 : 0)
      return `
        <tr style="background:#f8fafc;font-weight:700;">
          <td colspan="${colSpan}" style="text-align:right">Subtotal</td>
          <td style="text-align:right">$${Number(li.calculatedSubtotalTotal).toFixed(2)}</td>
        </tr>
      `
    }

    return `
      <tr>
        <td>${li.showDescriptionToCustomer !== false ? escapeHtml(li.description) : ''}</td>
        ${showNotesCol ? `<td>${escapeHtml(li.showNotesToCustomer === false ? '' : li.notes || '')}</td>` : ''}
        <td style="text-align:right">${Number(li.quantity).toFixed(2)}</td>
        ${showCostCol ? `<td style="text-align:right">${li.showCostToCustomer === true ? '$' + Number(li.unitCost || 0).toFixed(2) : ''}</td>` : ''}
        ${showPriceCol ? `<td style="text-align:right">${li.showPriceToCustomer !== false ? '$' + Number(li.unitPrice).toFixed(2) : ''}</td>` : ''}
        <td style="text-align:right">$${Number(li.total).toFixed(2)}</td>
      </tr>
    `
  }

  const rows = mainItems.map(buildRow).join('')
  const optionalRows = pendingOptionalItems.map(buildRow).join('')
  const approvedOptionalSubtotal = approvedOptionalItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
    0
  )
  const combinedSubtotal = Number(estimate.subtotal || 0) + approvedOptionalSubtotal
  const combinedDiscount = Number(estimate.discount || 0)
  const combinedTaxRate = Number(estimate.taxRate || 0)
  const combinedTax = Math.round((combinedSubtotal - combinedDiscount) * combinedTaxRate * 100) / 100
  const combinedTotal = Math.round((combinedSubtotal - combinedDiscount + combinedTax) * 100) / 100
  const client = estimate.client || {}

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Estimate ${escapeHtml(estimate.estimateNumber)}</title>
    <style>${buildDocumentCss(brand)}</style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div>
          ${buildBrandHeader(brand, 'Logo')}
          <h1 class="doc-title">Estimate</h1>
          <div class="muted">Generated on ${escapeHtml(new Date().toLocaleString())}</div>
        </div>
        <div class="meta">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(brand.businessName || 'TrimPro')}</div>
          ${brand.businessPhone ? `<div>${escapeHtml(brand.businessPhone)}</div>` : ''}
          ${brand.businessEmail ? `<div>${escapeHtml(brand.businessEmail)}</div>` : ''}
          ${brand.businessAddress ? `<div>${escapeHtml(brand.businessAddress)}</div>` : ''}
          <div style="margin-top:8px;"><strong>No.</strong> ${escapeHtml(estimate.estimateNumber)}</div>
          <div><strong>Status:</strong> ${escapeHtml(estimate.status)}</div>
          ${estimate.validUntil ? `<div><strong>Valid until:</strong> ${escapeHtml(dateOnly(estimate.validUntil))}</div>` : ''}
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <div><strong>${escapeHtml(client.companyName || client.name || 'Client')}</strong></div>
        ${client.email ? `<div class="muted">${escapeHtml(client.email)}</div>` : ''}
      </div>

      <table>
        <thead>${tableHeader()}</thead>
        <tbody>${rows}</tbody>
      </table>

      ${pendingOptionalItems.length > 0 ? `
        <div style="margin-top: 20px;">
          <h3 style="margin: 0 0 8px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #6b7280;">Optional Items</h3>
          <table>
            <thead>${tableHeader()}</thead>
            <tbody>${optionalRows}</tbody>
          </table>
          <div class="summary">
            <div class="summary-row total"><span>Optional Items</span><span>$${optionalSubtotal.toFixed(2)}</span></div>
          </div>
        </div>
      ` : ''}

      <div class="summary">
        <div class="summary-row"><span>Subtotal</span><span>$${combinedSubtotal.toFixed(2)}</span></div>
        ${combinedDiscount > 0 ? `<div class="summary-row"><span>Discount</span><span>-$${combinedDiscount.toFixed(2)}</span></div>` : ''}
        ${showTaxRow ? `<div class="summary-row"><span>Tax</span><span>$${combinedTax.toFixed(2)}</span></div>` : ''}
        <div class="summary-row total"><span>Total</span><span>$${combinedTotal.toFixed(2)}</span></div>
      </div>
    </div>
  </body>
</html>`
}

export async function renderInvoiceEmailPdfAttachment(invoice: AnyRecord, brand: AnyRecord): Promise<PdfEmailAttachment> {
  return {
    filename: `Invoice-${safeFilenamePart(invoice.invoiceNumber, 'invoice')}.pdf`,
    content: await renderPdfFromHtml(buildInvoiceEmailPdfHtml(invoice, brand)),
    contentType: 'application/pdf',
  }
}

export async function renderEstimateEmailPdfAttachment(
  estimate: AnyRecord,
  brand: AnyRecord,
  approvedOptionalItemIds: Set<string> = new Set()
): Promise<PdfEmailAttachment> {
  return {
    filename: `Estimate-${safeFilenamePart(estimate.estimateNumber, 'estimate')}.pdf`,
    content: await renderPdfFromHtml(buildEstimateEmailPdfHtml(estimate, brand, approvedOptionalItemIds)),
    contentType: 'application/pdf',
  }
}
