import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'
import type { PdfBranding } from '@/lib/branding/pdf'
import {
  buildInvoicePdfHtml,
  buildEstimatePdfHtml,
  buildPurchaseOrderPdfHtml,
  type PurchaseOrderPdfBranding,
} from '@/lib/documents/pdf-templates'

type AnyRecord = Record<string, any>

export interface PdfEmailAttachment {
  filename: string
  content: Buffer
  contentType: 'application/pdf'
}

function safeFilenamePart(value: unknown, fallback: string) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || fallback
}

/**
 * Renders the EXACT same Invoice PDF that the authenticated download route
 * produces, for attaching to invoice emails.
 */
export async function renderInvoiceEmailPdfAttachment(
  invoice: AnyRecord,
  brand: PdfBranding
): Promise<PdfEmailAttachment> {
  return {
    filename: `Invoice-${safeFilenamePart(invoice.invoiceNumber, 'invoice')}.pdf`,
    content: await renderPdfFromHtml(buildInvoicePdfHtml(invoice, brand)),
    contentType: 'application/pdf',
  }
}

/**
 * Renders the EXACT same Estimate PDF that the authenticated download route
 * produces, for attaching to estimate emails.
 */
export async function renderEstimateEmailPdfAttachment(
  estimate: AnyRecord,
  brand: PdfBranding,
  approvedOptionalItemIds: Set<string> = new Set()
): Promise<PdfEmailAttachment> {
  return {
    filename: `Estimate-${safeFilenamePart(estimate.estimateNumber, 'estimate')}.pdf`,
    content: await renderPdfFromHtml(buildEstimatePdfHtml(estimate, brand, approvedOptionalItemIds)),
    contentType: 'application/pdf',
  }
}

export async function renderPurchaseOrderEmailPdfAttachment(
  purchaseOrder: AnyRecord,
  branding: PurchaseOrderPdfBranding
): Promise<PdfEmailAttachment> {
  return {
    filename: `PO-${safeFilenamePart(purchaseOrder.poNumber, 'purchase-order')}.pdf`,
    content: await renderPdfFromHtml(buildPurchaseOrderPdfHtml(purchaseOrder, branding)),
    contentType: 'application/pdf',
  }
}
