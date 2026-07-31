/**
 * Single source of truth for the customer-facing Invoice and Estimate PDF HTML.
 *
 * Both the authenticated PDF download routes AND the email-attachment renderer
 * use these builders, so the PDF a customer downloads is byte-for-byte the same
 * document that gets attached to invoice/estimate emails.
 */
import {
  calculateOrderedSubtotalRows,
  mergeApprovedOptionalItemsForSubtotals,
} from '@/lib/documents/subtotals'
import type { PdfBranding } from '@/lib/branding/pdf'

type AnyRecord = Record<string, any>

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeHtmlMultiline(value: unknown) {
  return escapeHtml(value).replace(/\r?\n/g, '<br/>')
}

function formatAddress(address: {
  street?: string
  city?: string
  state?: string
  zipCode?: string
} | null | undefined): string | null {
  if (!address) return null
  const parts = [address.street, address.city, `${address.state || ''} ${address.zipCode || ''}`]
    .map((p) => (p || '').trim())
    .filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

const SHARED_DOC_CSS = (accentColor: string, accentTextColor: string) => `
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
  th, td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  td { white-space: pre-wrap; word-break: break-word; }
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
  .address-block {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.45;
  }
  .section { margin-top: 20px; }
  @media print {
    body { background: #fff; padding: 0; }
    .page { border: none; border-radius: 0; }
  }
`

function logoBlock(brand: PdfBranding, alt: string) {
  return brand.logoUrl
    ? `<img class="logo-image" src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(alt)}" />`
    : `<div class="logo-fallback">trimpro</div>`
}

export interface InvoicePdfBuildOptions {
  shouldPrint?: boolean
}

/**
 * Build the authoritative Invoice PDF HTML. Expects a Prisma invoice that
 * includes: client (+primary contacts), lineItems, optionalItems, job
 * (+job_site addresses), estimate (jobSiteAddress).
 */
export function buildInvoicePdfHtml(
  invoice: AnyRecord,
  brand: PdfBranding,
  options: InvoicePdfBuildOptions = {}
): string {
  const { shouldPrint = false } = options
  const accentColor = brand.accentColor
  const accentTextColor = brand.accentTextColor

  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : []
  const optionalItems = Array.isArray(invoice.optionalItems) ? invoice.optionalItems : []

  const visibleRegularItems = calculateOrderedSubtotalRows(
    lineItems.filter((item: AnyRecord) => item.isVisibleToClient !== false) as any[]
  )
  const visibleOptionalItems = optionalItems.filter((item: AnyRecord) => item.isVisibleToClient !== false)
  // Merge optional items into the main items — all items on an invoice are being billed
  const visibleLineItems = [...visibleRegularItems, ...visibleOptionalItems]
  const subtotal = visibleLineItems.reduce((sum: number, item: AnyRecord) => {
    if (item.isSubtotal) return sum
    return sum + Number(item.quantity) * Number(item.unitPrice)
  }, 0)

  const showNameCol =
    visibleLineItems.some((li: AnyRecord) => li.showDescriptionToCustomer !== false) ||
    visibleOptionalItems.some((li: AnyRecord) => li.showDescriptionToCustomer !== false)
  const showNotesCol =
    visibleLineItems.some((li: AnyRecord) => li.showNotesToCustomer !== false) ||
    visibleOptionalItems.some((li: AnyRecord) => li.showNotesToCustomer !== false)
  const showCostCol =
    visibleLineItems.some((li: AnyRecord) => li.showCostToCustomer === true) ||
    visibleOptionalItems.some((li: AnyRecord) => li.showCostToCustomer === true)
  const showPriceCol =
    visibleLineItems.some((li: AnyRecord) => li.showPriceToCustomer !== false) ||
    visibleOptionalItems.some((li: AnyRecord) => li.showPriceToCustomer !== false)

  const buildRow = (item: AnyRecord) => {
    if (item.isSubtotal) {
      const colSpan = (showNameCol ? 1 : 0) + (showNotesCol ? 1 : 0) + 1 + (showCostCol ? 1 : 0) + (showPriceCol ? 1 : 0)
      return `<tr style="background:#f8fafc;font-weight:700;">
        <td colspan="${colSpan}" style="text-align:right">Subtotal</td>
        <td class="text-right">$${Number(item.calculatedSubtotalTotal).toFixed(2)}</td>
      </tr>`
    }
    const nameCell = item.showDescriptionToCustomer !== false ? escapeHtmlMultiline(item.description) : ''
    const notesCell = item.showNotesToCustomer !== false ? escapeHtmlMultiline(item.notes || '') : ''
    const costCell = item.showCostToCustomer === true ? `$${Number(item.unitCost || 0).toFixed(2)}` : ''
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
  const optItemsSubtotal = visibleOptionalItems.reduce(
    (sum: number, item: AnyRecord) => sum + Number(item.quantity) * Number(item.unitPrice),
    0
  )
  const total = Number(invoice.total || 0) + optItemsSubtotal
  const balance = Number(invoice.balance || 0) + optItemsSubtotal
  const paid = Number(invoice.paidAmount || 0)
  const showNotes = invoice.isNotesVisibleToClient !== false && Boolean(invoice.notes)
  const generatedAt = new Date().toLocaleString()
  const invoiceDate = invoice.invoiceDate
    ? new Date(invoice.invoiceDate).toLocaleDateString()
    : new Date().toLocaleDateString()
  const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'
  const clientName = invoice.client?.companyName || invoice.client?.name || 'N/A'
  const primaryContact = invoice.client?.contacts?.[0] || null
  const jobSiteAddress =
    formatAddress(invoice.job?.addresses?.[0]) ||
    (invoice.estimate?.jobSiteAddress ? String(invoice.estimate.jobSiteAddress) : null)

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
        <style>${SHARED_DOC_CSS(accentColor, accentTextColor)}</style>
        ${shouldPrint ? '<script>window.addEventListener("load", () => window.print());</script>' : ''}
      </head>
      <body>
        <div class="page">
          <div class="header">
            <div>
              <div class="brand">
                ${logoBlock(brand, 'Trim Pro Logo')}
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
              ${jobSiteAddress ? `<div class="muted" style="margin-top:10px;font-weight:600;">Job Site Address</div><div class="address-block">${escapeHtmlMultiline(jobSiteAddress)}</div>` : ''}
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

          ${showNotes ? `<div class="notes">${escapeHtml(invoice.notes)}</div>` : ''}

          ${brand.footerText ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">${escapeHtml(brand.footerText)}</div>` : ''}

        </div>
      </body>
    </html>
  `
}

export interface EstimatePdfBuildOptions {
  shouldPrint?: boolean
}

/**
 * Build the authoritative Estimate PDF HTML. Expects a Prisma estimate that
 * includes: client, lineItems, optionalItems. `approvedOptionalItemIds`
 * controls which optional items have been approved (merged into the main table).
 */
export function buildEstimatePdfHtml(
  estimate: AnyRecord,
  brand: PdfBranding,
  approvedOptionalItemIds: Set<string> = new Set(),
  options: EstimatePdfBuildOptions = {}
): string {
  const { shouldPrint = false } = options
  const accentColor = brand.accentColor
  const accentTextColor = brand.accentTextColor

  const lineItems = Array.isArray(estimate.lineItems) ? estimate.lineItems : []
  const optionalItems = Array.isArray(estimate.optionalItems) ? estimate.optionalItems : []

  const visibleRegularItems = lineItems.filter((item: AnyRecord) => item.isVisibleToClient !== false)
  const allVisibleOptionalItems = optionalItems.filter((item: AnyRecord) => item.isVisibleToClient !== false)
  const approvedOptionalItems = allVisibleOptionalItems.filter((li: AnyRecord) => approvedOptionalItemIds.has(li.id))
  const pendingOptionalItems = allVisibleOptionalItems.filter((li: AnyRecord) => !approvedOptionalItemIds.has(li.id))
  const visibleItems = calculateOrderedSubtotalRows(
    mergeApprovedOptionalItemsForSubtotals(visibleRegularItems as any[], approvedOptionalItems as any[])
  )
  const visibleOptionalItems = pendingOptionalItems

  const regularSubtotal = visibleRegularItems.reduce(
    (sum: number, item: AnyRecord) => sum + Number(item.quantity) * Number(item.unitPrice),
    0
  )
  const approvedOptionalSubtotal = approvedOptionalItems.reduce(
    (sum: number, item: AnyRecord) => sum + Number(item.quantity) * Number(item.unitPrice),
    0
  )
  const subtotal = regularSubtotal + approvedOptionalSubtotal
  const optionalSubtotal = pendingOptionalItems.reduce(
    (sum: number, item: AnyRecord) => sum + Number(item.quantity) * Number(item.unitPrice),
    0
  )

  const showNameCol =
    visibleItems.some((li: AnyRecord) => li.showDescriptionToCustomer !== false) ||
    visibleOptionalItems.some((li: AnyRecord) => li.showDescriptionToCustomer !== false)
  const showNotesCol =
    visibleItems.some((li: AnyRecord) => li.showNotesToCustomer !== false) ||
    visibleOptionalItems.some((li: AnyRecord) => li.showNotesToCustomer !== false)
  const showCostCol =
    visibleItems.some((li: AnyRecord) => li.showCostToCustomer === true) ||
    visibleOptionalItems.some((li: AnyRecord) => li.showCostToCustomer === true)
  const showPriceCol =
    visibleItems.some((li: AnyRecord) => li.showPriceToCustomer !== false) ||
    visibleOptionalItems.some((li: AnyRecord) => li.showPriceToCustomer !== false)

  const buildRow = (item: AnyRecord) => {
    if (item.isSubtotal) {
      const colSpan = (showNameCol ? 1 : 0) + (showNotesCol ? 1 : 0) + 1 + (showCostCol ? 1 : 0) + (showPriceCol ? 1 : 0)
      return `<tr style="background:#f8fafc;font-weight:700;">
        <td colspan="${colSpan}" style="text-align:right">Subtotal</td>
        <td class="text-right">$${Number(item.calculatedSubtotalTotal).toFixed(2)}</td>
      </tr>`
    }
    const nameCell = item.showDescriptionToCustomer !== false ? escapeHtmlMultiline(item.description) : ''
    const notesCell = item.showNotesToCustomer !== false ? escapeHtmlMultiline(item.notes || '') : ''
    const costCell = item.showCostToCustomer === true ? `$${Number(item.unitCost || 0).toFixed(2)}` : ''
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

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Estimate ${escapeHtml(estimate.estimateNumber)}</title>
        <style>${SHARED_DOC_CSS(accentColor, accentTextColor)}</style>
        ${shouldPrint ? '<script>window.addEventListener("load", () => window.print());</script>' : ''}
      </head>
      <body>
        <div class="page">
          <div class="header">
            <div>
              <div class="brand">
                ${logoBlock(brand, 'Trim Pro Logo')}
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
              ${estimate.jobSiteAddress ? `<div class="muted" style="margin-top:10px;font-weight:600;">Job Address</div><div>${escapeHtml(String(estimate.jobSiteAddress))}</div>` : ''}
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
              <h3>Terms &amp; Conditions</h3>
              <div class="notes">${escapeHtml(estimate.terms)}</div>
            </div>
          ` : ''}

          ${brand.footerText ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">${escapeHtml(brand.footerText)}</div>` : ''}
        </div>
      </body>
    </html>
  `
}

export interface PurchaseOrderPdfBranding {
  logoUrl: string | null
  businessName?: string | null
}

export interface PurchaseOrderPdfBuildOptions {
  shouldPrint?: boolean
}

export function buildPurchaseOrderPdfHtml(
  purchaseOrder: AnyRecord,
  branding: PurchaseOrderPdfBranding,
  options: PurchaseOrderPdfBuildOptions = {}
): string {
  const { shouldPrint = false } = options
  const lineItems = Array.isArray(purchaseOrder.lineItems) ? purchaseOrder.lineItems : []
  const subtotal = lineItems.reduce((sum: number, item: AnyRecord) => {
    return sum + Number(item.quantity) * Number(item.unitPrice)
  }, 0)
  const total = Number(purchaseOrder.total || 0)
  const generatedAt = new Date().toLocaleString()
  const orderDate = purchaseOrder.orderDate
    ? new Date(purchaseOrder.orderDate).toLocaleDateString()
    : new Date().toLocaleDateString()
  const expectedDate = purchaseOrder.expectedDate
    ? new Date(purchaseOrder.expectedDate).toLocaleDateString()
    : 'N/A'
  const jobSiteAddress = formatAddress(purchaseOrder.job?.addresses?.[0] || null)

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Purchase Order ${escapeHtml(purchaseOrder.poNumber)}</title>
        <style>${SHARED_DOC_CSS('#12344d', '#f5e7b8')}
          .line-details { color: #334155; font-size: 12px; margin-top: 4px; white-space: pre-wrap; }
          .line-notes { color: #64748b; font-size: 12px; margin-top: 4px; white-space: pre-wrap; }
          .footer {
            margin-top: 22px;
            padding-top: 12px;
            border-top: 1px solid #e5e7eb;
            font-size: 12px;
            color: #6b7280;
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
                  branding.logoUrl
                    ? `<img class="logo-image" src="${escapeHtml(branding.logoUrl)}" alt="Trim Pro Logo" />`
                    : '<div class="logo-fallback">trimpro</div>'
                }
              </div>
              <h1 class="doc-title">Purchase Order</h1>
              <div class="muted">Generated on ${generatedAt}</div>
            </div>
            <div class="meta">
              ${branding.businessName ? `<div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(branding.businessName)}</div>` : ''}
              <div><strong>No.</strong> ${escapeHtml(purchaseOrder.poNumber)}</div>
              <div><strong>Order Date:</strong> ${escapeHtml(orderDate)}</div>
              <div><strong>Expected:</strong> ${escapeHtml(expectedDate)}</div>
            </div>
          </div>

          <div class="grid">
            <div class="panel">
              <h3>Vendor</h3>
              <div><strong>${escapeHtml(purchaseOrder.vendorRef?.name || purchaseOrder.vendor || 'N/A')}</strong></div>
              ${purchaseOrder.vendorRef?.contactPerson ? `<div class="muted">Contact: ${escapeHtml(purchaseOrder.vendorRef.contactPerson)}</div>` : ''}
              ${purchaseOrder.vendorRef?.email ? `<div class="muted">${escapeHtml(purchaseOrder.vendorRef.email)}</div>` : ''}
              ${purchaseOrder.vendorRef?.phone ? `<div class="muted">${escapeHtml(purchaseOrder.vendorRef.phone)}</div>` : ''}
            </div>
            <div class="panel">
              <h3>Job</h3>
              ${
                purchaseOrder.job
                  ? `
                    <div><strong>${escapeHtml(purchaseOrder.job.jobNumber)}</strong></div>
                    <div>${escapeHtml(purchaseOrder.job.title)}</div>
                    <div class="muted">Client: ${escapeHtml(purchaseOrder.job.client?.name || '')}</div>
                    ${jobSiteAddress ? `<div class="muted" style="margin-top:10px;font-weight:600;">Job Site Address</div><div class="address-block">${escapeHtmlMultiline(jobSiteAddress)}</div>` : ''}
                  `
                  : '<div class="muted">No linked job</div>'
              }
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th class="text-right">Quantity</th>
                <th class="text-right">Unit Price</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${lineItems
                .map(
                  (item: AnyRecord) => `
                    <tr>
                      <td>
                        ${escapeHtmlMultiline(item.description)}
                        ${item.details?.trim() ? `<div class="line-details"><strong>Description:</strong> ${escapeHtmlMultiline(item.details.trim())}</div>` : ''}
                        ${item.notes?.trim() ? `<div class="line-notes"><strong>Special notes:</strong> ${escapeHtmlMultiline(item.notes.trim())}</div>` : ''}
                      </td>
                      <td class="text-right">${Number(item.quantity).toFixed(2)}</td>
                      <td class="text-right">$${Number(item.unitPrice).toFixed(2)}</td>
                      <td class="text-right">$${Number(item.total).toFixed(2)}</td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>

          ${purchaseOrder.notes?.trim() ? `
            <div class="panel" style="margin-top:18px;">
              <h3>Notes</h3>
              <div style="white-space:pre-wrap;">${escapeHtml(purchaseOrder.notes.trim())}</div>
            </div>
          ` : ''}

          <div class="summary">
            <h4>Summary</h4>
            <div class="summary-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
            <div class="summary-row total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
          </div>

          <div class="footer">
            <p>This is an official purchase order from Trim Pro.</p>
            <p>Generated on ${generatedAt}</p>
          </div>
        </div>
      </body>
    </html>
  `
}
