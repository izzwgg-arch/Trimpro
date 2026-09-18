import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { splitEmailList } from '@/lib/email'
import { getPdfBranding } from '@/lib/branding/pdf'
import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'
import {
  appBaseUrl,
  formatPaymentMethodLabel,
  isPaymentReceiptTokenValid,
} from '@/lib/payments/receipts'

const RECEIPT_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000

function randomToken() {
  return crypto.randomBytes(32).toString('hex')
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount || 0))
}

function formatReceiptDate(value: Date | string | null | undefined) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export type PaymentGroupReceiptLine = {
  paymentId: string
  invoiceId: string
  invoiceNumber: string
  amount: number
  invoiceTotal: number
  invoiceBalance: number
  invoiceUrl: string
}

export type PaymentGroupReceiptContext = {
  groupId: string
  tenantId: string
  tenantName: string
  clientName: string
  clientEmail: string | null
  methodLabel: string
  reference: string | null
  paidAt: Date
  totalAmount: number
  creditAmount: number
  receiptToken: string | null
  receiptUrl: string
  lines: PaymentGroupReceiptLine[]
}

const groupReceiptInclude = {
  invoice: {
    include: {
      tenant: { select: { name: true } },
      client: {
        select: {
          name: true,
          email: true,
          contacts: {
            where: { email: { not: null } },
            orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
            take: 1,
            select: { email: true },
          },
        },
      },
    },
  },
} as const

type GroupPaymentRow = {
  id: string
  amount: unknown
  method: string
  provider: string | null
  notes: string | null
  reference: string | null
  processedAt: Date | null
  createdAt: Date
  receiptToken: string | null
  receiptTokenExpiresAt: Date | null
  invoice: {
    id: string
    invoiceNumber: string
    tenantId: string
    total: unknown
    balance: unknown
    paymentToken: string | null
    tenant: { name: string } | null
    client: {
      name: string
      email: string | null
      contacts: { email: string | null }[]
    } | null
  }
}

function mapGroupToContext(
  groupId: string,
  payments: GroupPaymentRow[],
  token: string | null,
  creditAmount = 0
): PaymentGroupReceiptContext {
  const appUrl = appBaseUrl()
  const primary = payments[0]
  const clientEmail =
    splitEmailList(primary.invoice.client?.email || '')[0] ||
    String(primary.invoice.client?.contacts?.[0]?.email || '').trim() ||
    null

  const lines: PaymentGroupReceiptLine[] = payments.map((p) => ({
    paymentId: p.id,
    invoiceId: p.invoice.id,
    invoiceNumber: p.invoice.invoiceNumber,
    amount: Number(p.amount || 0),
    invoiceTotal: Number(p.invoice.total || 0),
    invoiceBalance: Number(p.invoice.balance || 0),
    invoiceUrl: p.invoice.paymentToken
      ? `${appUrl}/portal/pay/${p.invoice.id}?token=${encodeURIComponent(p.invoice.paymentToken)}`
      : `${appUrl}/portal/pay/${p.invoice.id}`,
  }))

  return {
    groupId,
    tenantId: primary.invoice.tenantId,
    tenantName: primary.invoice.tenant?.name || 'TrimPro',
    clientName: primary.invoice.client?.name || 'Customer',
    clientEmail,
    methodLabel: formatPaymentMethodLabel(primary),
    reference: primary.reference,
    paidAt: primary.processedAt || primary.createdAt,
    totalAmount: lines.reduce((sum, l) => sum + l.amount, 0),
    creditAmount: Number(creditAmount || 0),
    receiptToken: token,
    receiptUrl: token ? `${appUrl}/pay/receipt/group/${encodeURIComponent(token)}` : '',
    lines,
  }
}

async function sumGroupCredit(groupId: string): Promise<number> {
  const agg = await prisma.customerCredit.aggregate({
    where: { sourcePaymentGroupId: groupId },
    _sum: { originalAmount: true },
  })
  return Number(agg._sum.originalAmount || 0)
}

/**
 * Ensure the group's "primary" (earliest) payment carries a receipt token, so a
 * single stable public link can represent the whole group. Returns the token.
 */
async function ensureGroupToken(payments: GroupPaymentRow[]): Promise<string> {
  const primary = payments[0]
  if (primary.receiptToken) return primary.receiptToken
  const token = randomToken()
  const expires = new Date(Date.now() + RECEIPT_TOKEN_TTL_MS)
  await prisma.payment.update({
    where: { id: primary.id },
    data: { receiptToken: token, receiptTokenExpiresAt: expires },
  })
  primary.receiptToken = token
  primary.receiptTokenExpiresAt = expires
  return token
}

export async function loadPaymentGroupReceiptContext(
  groupId: string,
  tenantId: string
): Promise<PaymentGroupReceiptContext | null> {
  const payments = (await prisma.payment.findMany({
    where: { paymentGroupId: groupId, invoice: { tenantId } },
    include: groupReceiptInclude as any,
    orderBy: { createdAt: 'asc' },
  })) as unknown as GroupPaymentRow[]

  if (payments.length === 0 || !payments[0].invoice) return null

  const token = await ensureGroupToken(payments)
  return mapGroupToContext(groupId, payments, token, await sumGroupCredit(groupId))
}

export async function loadPaymentGroupReceiptContextByToken(
  receiptToken: string
): Promise<PaymentGroupReceiptContext | null> {
  const token = String(receiptToken || '').trim()
  if (!token) return null

  const anchor = await prisma.payment.findFirst({
    where: { receiptToken: token },
    select: { paymentGroupId: true, receiptTokenExpiresAt: true },
  })
  if (!anchor?.paymentGroupId) return null
  if (!isPaymentReceiptTokenValid(anchor)) return null

  const payments = (await prisma.payment.findMany({
    where: { paymentGroupId: anchor.paymentGroupId },
    include: groupReceiptInclude as any,
    orderBy: { createdAt: 'asc' },
  })) as unknown as GroupPaymentRow[]

  if (payments.length === 0 || !payments[0].invoice) return null

  return mapGroupToContext(anchor.paymentGroupId, payments, token, await sumGroupCredit(anchor.paymentGroupId))
}

export function buildPaymentGroupReceiptHtml(
  ctx: PaymentGroupReceiptContext,
  logoUrl?: string | null
) {
  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="Logo" style="max-height:56px;max-width:200px;margin-bottom:12px;" />`
    : `<div style="font-size:22px;font-weight:800;color:#1e4d6e;margin-bottom:8px;">${escapeHtml(ctx.tenantName)}</div>`

  const rows = ctx.lines
    .map(
      (l) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;font-weight:600;">${escapeHtml(l.invoiceNumber)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;color:#6b7280;">${escapeHtml(formatMoney(l.invoiceTotal))}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;font-weight:700;">${escapeHtml(formatMoney(l.amount))}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;color:#6b7280;">${escapeHtml(formatMoney(l.invoiceBalance))}</td>
      </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Payment Receipt — ${escapeHtml(ctx.clientName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; margin: 0; padding: 0; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 32px 24px; }
    .card { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
    .header { background: #f8fafc; padding: 24px; border-bottom: 1px solid #e5e7eb; }
    .amount { font-size: 32px; font-weight: 800; color: #1e4d6e; margin: 8px 0 0; }
    .body { padding: 24px; }
    table.meta { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    table.meta td { padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
    table.meta td.label { color: #6b7280; width: 40%; font-weight: 600; }
    table.meta td.value { text-align: right; font-weight: 600; }
    table.lines { width: 100%; border-collapse: collapse; margin-top: 18px; }
    table.lines th { text-align: right; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #64748b; padding: 8px 0; border-bottom: 2px solid #e5e7eb; }
    table.lines th.first { text-align: left; }
    table.lines td.first { text-align: left; }
    tr.total td { padding-top: 14px; font-size: 15px; font-weight: 800; border-bottom: none; }
    .footer { margin-top: 24px; font-size: 12px; color: #6b7280; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">
        ${logoBlock}
        <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;">Payment Receipt</div>
        <div class="amount">${escapeHtml(formatMoney(ctx.totalAmount + ctx.creditAmount))}</div>
        <div style="font-size:13px;color:#64748b;margin-top:6px;">Applied across ${ctx.lines.length} invoice${ctx.lines.length === 1 ? '' : 's'}${ctx.creditAmount > 0 ? ` · ${escapeHtml(formatMoney(ctx.creditAmount))} credit` : ''}</div>
      </div>
      <div class="body">
        <table class="meta">
          <tr><td class="label">Customer</td><td class="value">${escapeHtml(ctx.clientName)}</td></tr>
          <tr><td class="label">Payment Date</td><td class="value">${escapeHtml(formatReceiptDate(ctx.paidAt))}</td></tr>
          <tr><td class="label">Payment Method</td><td class="value">${escapeHtml(ctx.methodLabel)}</td></tr>
          ${
            ctx.reference
              ? `<tr><td class="label">Reference</td><td class="value">${escapeHtml(ctx.reference)}</td></tr>`
              : ''
          }
        </table>
        <table class="lines">
          <thead>
            <tr>
              <th class="first">Invoice</th>
              <th>Invoice Total</th>
              <th>Amount Applied</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="total">
              <td class="first">Applied to invoices</td>
              <td></td>
              <td style="text-align:right;">${escapeHtml(formatMoney(ctx.totalAmount))}</td>
              <td></td>
            </tr>
            ${
              ctx.creditAmount > 0
                ? `<tr class="total"><td class="first" style="color:#047857;">Held as account credit</td><td></td><td style="text-align:right;color:#047857;">${escapeHtml(formatMoney(ctx.creditAmount))}</td><td></td></tr>
            <tr class="total"><td class="first">Total received</td><td></td><td style="text-align:right;">${escapeHtml(formatMoney(ctx.totalAmount + ctx.creditAmount))}</td><td></td></tr>`
                : ''
            }
          </tbody>
        </table>
      </div>
    </div>
    <p class="footer">Thank you for your business — ${escapeHtml(ctx.tenantName)}</p>
  </div>
</body>
</html>`
}

async function buildGroupPdfFromContext(ctx: PaymentGroupReceiptContext) {
  const brand = await getPdfBranding(ctx.tenantId)
  const html = buildPaymentGroupReceiptHtml(ctx, brand.logoUrl)
  const safeName = String(ctx.clientName || 'customer').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return {
    buffer: await renderPdfFromHtml(html, { waitUntil: 'load' }),
    filename: `receipt-${safeName || 'customer'}-${ctx.groupId.slice(-8)}.pdf`,
    html,
    ctx,
  }
}

export async function getPaymentGroupReceiptHtmlByToken(receiptToken: string) {
  const ctx = await loadPaymentGroupReceiptContextByToken(receiptToken)
  if (!ctx) return null
  const brand = await getPdfBranding(ctx.tenantId)
  return { html: buildPaymentGroupReceiptHtml(ctx, brand.logoUrl), ctx }
}

export async function getPaymentGroupReceiptHtml(groupId: string, tenantId: string) {
  const ctx = await loadPaymentGroupReceiptContext(groupId, tenantId)
  if (!ctx) return null
  const brand = await getPdfBranding(ctx.tenantId)
  return { html: buildPaymentGroupReceiptHtml(ctx, brand.logoUrl), ctx }
}

export async function generatePaymentGroupReceiptPdf(groupId: string, tenantId: string) {
  const ctx = await loadPaymentGroupReceiptContext(groupId, tenantId)
  if (!ctx) return null
  return buildGroupPdfFromContext(ctx)
}

export async function generatePaymentGroupReceiptPdfByToken(receiptToken: string) {
  const ctx = await loadPaymentGroupReceiptContextByToken(receiptToken)
  if (!ctx) return null
  return buildGroupPdfFromContext(ctx)
}
