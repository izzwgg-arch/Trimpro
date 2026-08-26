import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'
import { getPdfBranding } from '@/lib/branding/pdf'
import { buildRevenueReportPdfHtml } from '@/lib/documents/pdf-templates'
import { csvResponse } from '@/lib/reports/csv'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'reports.view')
  if (permError) return permError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const format = String(searchParams.get('format') || 'json').toLowerCase()
  const startDateRaw = String(searchParams.get('startDate') || '').trim()
  const endDateRaw = String(searchParams.get('endDate') || '').trim()

  const endDate = endDateRaw ? new Date(endDateRaw + 'T23:59:59.999') : new Date()
  const startDate = startDateRaw
    ? new Date(startDateRaw)
    : new Date(endDate.getFullYear(), endDate.getMonth() - 11, 1) // default: trailing 12 months

  try {
    const invoiced = await prisma.$queryRaw<Array<{ month: string; revenue: string }>>`
      SELECT TO_CHAR("invoiceDate", 'YYYY-MM') as month, COALESCE(SUM(total), 0)::text as revenue
      FROM invoices
      WHERE "tenantId" = ${user.tenantId}
        AND status NOT IN ('DRAFT', 'CANCELLED')
        AND "invoiceDate" >= ${startDate}
        AND "invoiceDate" <= ${endDate}
      GROUP BY TO_CHAR("invoiceDate", 'YYYY-MM')
      ORDER BY month ASC
    `

    const collected = await prisma.$queryRaw<Array<{ month: string; amount: string }>>`
      SELECT TO_CHAR(p."processedAt", 'YYYY-MM') as month, COALESCE(SUM(p.amount - p."refundedAmount"), 0)::text as amount
      FROM payments p
      JOIN invoices i ON i.id = p."invoiceId"
      WHERE i."tenantId" = ${user.tenantId}
        AND p.status = 'COMPLETED'
        AND p."processedAt" >= ${startDate}
        AND p."processedAt" <= ${endDate}
      GROUP BY TO_CHAR(p."processedAt", 'YYYY-MM')
      ORDER BY month ASC
    `

    const invoicedMap = new Map(invoiced.map((r) => [r.month, Number(r.revenue)]))
    const collectedMap = new Map(collected.map((r) => [r.month, Number(r.amount)]))

    // Build a complete list of months in range so gaps show as $0, not missing.
    const months: string[] = []
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1)
    while (cursor <= end) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
      cursor.setMonth(cursor.getMonth() + 1)
    }

    const rows = months.map((month) => ({
      month,
      invoiced: invoicedMap.get(month) || 0,
      collected: collectedMap.get(month) || 0,
    }))

    const totalInvoiced = rows.reduce((sum, r) => sum + r.invoiced, 0)
    const totalCollected = rows.reduce((sum, r) => sum + r.collected, 0)

    // Period-over-period: compare to the immediately preceding period of equal length.
    const periodMs = endDate.getTime() - startDate.getTime()
    const prevEnd = new Date(startDate.getTime() - 1)
    const prevStart = new Date(prevEnd.getTime() - periodMs)
    const prevInvoicedResult = await prisma.invoice.aggregate({
      where: {
        tenantId: user.tenantId,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        invoiceDate: { gte: prevStart, lte: prevEnd },
      },
      _sum: { total: true },
    })
    const prevInvoiced = Number(prevInvoicedResult._sum.total || 0)
    const changePercent = prevInvoiced > 0 ? ((totalInvoiced - prevInvoiced) / prevInvoiced) * 100 : null

    const summary = { totalInvoiced, totalCollected, prevInvoiced, changePercent }

    if (format === 'csv') {
      const csvRows: Array<Array<string | number>> = [
        ['Month', 'Invoiced', 'Collected'],
        ...rows.map((r) => [r.month, r.invoiced.toFixed(2), r.collected.toFixed(2)]),
        [],
        ['Total Invoiced', totalInvoiced.toFixed(2)],
        ['Total Collected', totalCollected.toFixed(2)],
        ['Previous Period Invoiced', prevInvoiced.toFixed(2)],
        ['Change %', changePercent === null ? 'N/A' : changePercent.toFixed(1)],
      ]
      return csvResponse(csvRows, `revenue-report-${new Date().toISOString().split('T')[0]}.csv`)
    }

    if (format === 'pdf' || format === 'html') {
      const brand = await getPdfBranding(user.tenantId)
      const html = buildRevenueReportPdfHtml({ rows, summary, startDate, endDate }, brand)
      if (format === 'html') {
        return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
      try {
        const pdf = await renderPdfFromHtml(html)
        return new NextResponse(pdf, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="revenue-report.pdf"`,
          },
        })
      } catch (e) {
        console.error('Revenue report PDF render failed, falling back to HTML:', e)
        return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
    }

    return NextResponse.json({ rows, summary })
  } catch (error) {
    console.error('Revenue report error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
