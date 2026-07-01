import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { validateRequest } from '@/lib/validation'
import { z } from 'zod'
import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'

const runReportSchema = z.object({
  format: z.enum(['csv', 'json', 'pdf']).default('json'),
})

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getNestedValue(row: any, col: string): unknown {
  if (!col.includes('.')) return row?.[col]
  return col.split('.').reduce((obj: any, key) => obj?.[key], row)
}

function prettyColumnName(col: string): string {
  const last = col.split('.').pop() || col
  return last
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase())
}

function formatCellValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toLocaleString()
    return JSON.stringify(value)
  }
  const asString = String(value)
  const asDate = new Date(asString)
  if (!Number.isNaN(asDate.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(asString)) {
    return asDate.toLocaleString()
  }
  return asString
}

function toMoneyNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function getRowSubtotal(row: any): number {
  if (row && typeof row === 'object') {
    if (row.subtotal != null) return toMoneyNumber(row.subtotal)

    const lineItems = Array.isArray(row.lineItems) ? row.lineItems : []
    if (lineItems.length > 0) {
      return lineItems.reduce((sum: number, item: any) => {
        if (item?.total != null) return sum + toMoneyNumber(item.total)
        const qty = toMoneyNumber(item?.quantity)
        const unitPrice = toMoneyNumber(item?.unitPrice)
        return sum + qty * unitPrice
      }, 0)
    }
  }

  return 0
}

function getReportSummary(rows: any[]) {
  const raw = rows.reduce(
    (acc, row) => {
      const subtotal = getRowSubtotal(row)
      const tax = row?.taxAmount != null ? toMoneyNumber(row.taxAmount) : toMoneyNumber(row?.tax)
      const discount = toMoneyNumber(row?.discount)
      const fees = toMoneyNumber(row?.fees) + toMoneyNumber(row?.fee)
      const total =
        row?.total != null
          ? toMoneyNumber(row.total)
          : subtotal - discount + tax + fees

      acc.subtotal += subtotal
      acc.tax += tax
      acc.discount += discount
      acc.fees += fees
      acc.total += total
      return acc
    },
    { subtotal: 0, tax: 0, discount: 0, fees: 0, total: 0 }
  )

  return {
    subtotal: roundMoney(raw.subtotal),
    tax: roundMoney(raw.tax),
    discount: roundMoney(raw.discount),
    fees: roundMoney(raw.fees),
    total: roundMoney(raw.total),
  }
}

function buildReportPdfHtml(input: {
  reportName: string
  dataset: string
  totalRows: number
  generatedAt: string
  columns: string[]
  rows: any[]
  summary: {
    subtotal: number
    tax: number
    discount: number
    fees: number
    total: number
  }
}): string {
  const { reportName, dataset, totalRows, generatedAt, columns, rows, summary } = input
  const headerCells = columns
    .map(
      (col) =>
        `<th style="text-align:left;padding:10px 12px;font-size:12px;font-weight:700;color:#334155;border-bottom:1px solid #e2e8f0;background:#f8fafc;">${escapeHtml(prettyColumnName(col))}</th>`
    )
    .join('')
  const bodyRows = rows
    .map((row, idx) => {
      const cells = columns
        .map((col) => {
          const value = formatCellValue(getNestedValue(row, col))
          return `<td style="padding:10px 12px;font-size:11px;color:#0f172a;border-bottom:1px solid #f1f5f9;vertical-align:top;word-break:break-word;">${escapeHtml(value)}</td>`
        })
        .join('')
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc'
      return `<tr style="background:${bg};">${cells}</tr>`
    })
    .join('')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(reportName)}</title>
  </head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f1f5f9;color:#0f172a;">
    <div style="padding:18px 0;">
      <div style="max-width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 18px;background:linear-gradient(135deg,#243f53 0%,#1e3345 100%);color:#f8dea4;">
          <div style="font-size:20px;font-weight:800;line-height:1.2;">${escapeHtml(reportName)}</div>
          <div style="margin-top:8px;font-size:12px;color:#e2e8f0;">
            Dataset: ${escapeHtml(dataset)} • Rows: ${escapeHtml(totalRows)} • Generated: ${escapeHtml(generatedAt)}
          </div>
        </div>
        <div style="padding:14px 16px 16px;">
          <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows || '<tr><td style="padding:12px;font-size:12px;color:#64748b;" colspan="' + columns.length + '">No results found.</td></tr>'}</tbody>
          </table>
          <div style="margin-top:14px;padding-top:10px;border-top:1px solid #e2e8f0;max-width:320px;margin-left:auto;">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#334155;padding:2px 0;"><span>Subtotal</span><span>$${summary.subtotal.toFixed(2)}</span></div>
            ${summary.tax !== 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#334155;padding:2px 0;"><span>Tax</span><span>$${summary.tax.toFixed(2)}</span></div>` : ''}
            ${summary.discount !== 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#334155;padding:2px 0;"><span>Discount</span><span>-$${summary.discount.toFixed(2)}</span></div>` : ''}
            ${summary.fees !== 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#334155;padding:2px 0;"><span>Fees</span><span>$${summary.fees.toFixed(2)}</span></div>` : ''}
            <div style="display:flex;justify-content:space-between;font-size:13px;color:#0f172a;padding:7px 0 2px;border-top:1px solid #cbd5e1;margin-top:6px;font-weight:700;"><span>Total</span><span>$${summary.total.toFixed(2)}</span></div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'reports.run')
  if (permError) return permError

  const user = getAuthUser(request)
  const reportId = params.id

  const validation = await validateRequest(request, runReportSchema)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  const { format } = validation.data

  try {
    const report = await prisma.report.findFirst({
      where: {
        id: reportId,
        tenantId: user.tenantId,
      },
    })

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Check access
    if (!report.isPublic && report.createdBy !== user.id && !report.sharedWith.includes(user.id)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Execute report query based on dataset
    let data: any[] = []
    const filters = (report.filters as any) || []
    const where: any = { tenantId: user.tenantId }

    // Apply filters
    filters.forEach((filter: any) => {
      if (filter.field && filter.value) {
        switch (filter.operator) {
          case 'equals':
            where[filter.field] = filter.value
            break
          case 'notEquals':
            where[filter.field] = { not: filter.value }
            break
          case 'contains':
            where[filter.field] = { contains: filter.value, mode: 'insensitive' }
            break
          case 'greaterThan':
            where[filter.field] = { gt: filter.value }
            break
          case 'lessThan':
            where[filter.field] = { lt: filter.value }
            break
        }
      }
    })

    // Execute query based on dataset
    switch (report.dataset) {
      case 'jobs':
        data = await prisma.job.findMany({
          where,
          take: 1000,
          include: {
            client: {
              select: { name: true },
            },
          },
        })
        break
      case 'invoices':
        data = await prisma.invoice.findMany({
          where,
          take: 1000,
          include: {
            client: {
              select: { name: true },
            },
          },
        })
        break
      case 'leads':
        data = await prisma.lead.findMany({
          where,
          take: 1000,
        })
        break
      case 'clients':
        data = await prisma.client.findMany({
          where,
          take: 1000,
        })
        break
      default:
        return NextResponse.json({ error: 'Unsupported dataset' }, { status: 400 })
    }

    // Create report run record
    const reportRun = await prisma.reportRun.create({
      data: {
        reportId: report.id,
        tenantId: user.tenantId,
        runBy: user.id,
        status: 'COMPLETED',
        format,
      },
    })

    const summary = getReportSummary(data)

    if (format === 'csv') {
      // Convert to CSV
      const columns = (report.columns as string[]) || []
      const csvRows = [
        columns.join(','),
        ...data.map((row) =>
          columns
            .map((col) => {
              const value = col.includes('.') 
                ? col.split('.').reduce((obj: any, key) => obj?.[key], row) 
                : row[col]
              return `"${String(value || '').replace(/"/g, '""')}"`
            })
            .join(',')
        ),
        '',
        `"Summary","Amount"`,
        `"Subtotal","${summary.subtotal.toFixed(2)}"`,
        ...(summary.tax !== 0 ? [`"Tax","${summary.tax.toFixed(2)}"`] : []),
        ...(summary.discount !== 0 ? [`"Discount","-${summary.discount.toFixed(2)}"`] : []),
        ...(summary.fees !== 0 ? [`"Fees","${summary.fees.toFixed(2)}"`] : []),
        `"Total","${summary.total.toFixed(2)}"`,
      ]

      return new NextResponse(csvRows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="report-${report.name}-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    }

    if (format === 'pdf') {
      const selectedColumns = (report.columns as string[]) || []
      const columns =
        selectedColumns.length > 0
          ? selectedColumns
          : Array.from(
              new Set(
                data.flatMap((row) =>
                  Object.keys(row).filter((k) => typeof row?.[k] !== 'object' && !Array.isArray(row?.[k]))
                )
              )
            ).slice(0, 8)
      if (columns.length === 0) {
        columns.push('id')
      }

      const html = buildReportPdfHtml({
        reportName: report.name,
        dataset: report.dataset || 'custom',
        totalRows: data.length,
        generatedAt: new Date().toLocaleString(),
        columns,
        rows: data,
        summary,
      })

      const pdfBuffer = await renderPdfFromHtml(html)
      const safeName = report.name.replace(/[^a-z0-9-_]+/gi, '-')
      return new NextResponse(pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${safeName}-${new Date().toISOString().split('T')[0]}.pdf"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json({
      reportRun,
      data,
      total: data.length,
      summary,
    })
  } catch (error) {
    console.error('Run report error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
