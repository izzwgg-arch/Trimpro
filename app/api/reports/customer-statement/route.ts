import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { renderPdfFromHtml } from '@/lib/pdf/render-html-to-pdf'
import { getPdfBranding } from '@/lib/branding/pdf'
import { buildCustomerStatementPdfHtml } from '@/lib/documents/pdf-templates'
import { csvResponse } from '@/lib/reports/csv'

type TransactionRow = {
  date: Date
  type: 'INVOICE' | 'PAYMENT' | 'CREDIT_MEMO'
  description: string
  reference: string
  debit: number
  credit: number
}

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'reports.view')
  if (permError) return permError

  const user = getAuthUser(request)
  const { searchParams } = new URL(request.url)
  const clientId = String(searchParams.get('clientId') || '').trim()
  const format = String(searchParams.get('format') || 'json').toLowerCase()
  const startDateRaw = String(searchParams.get('startDate') || '').trim()
  const endDateRaw = String(searchParams.get('endDate') || '').trim()
  const startDate = startDateRaw ? new Date(startDateRaw) : null
  const endDate = endDateRaw ? new Date(endDateRaw + 'T23:59:59.999') : null

  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  }

  try {
    const client = await prisma.client.findFirst({
      where: { id: clientId, tenantId: user.tenantId },
      include: {
        addresses: { where: { type: 'billing' }, take: 1 },
      },
    })
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const dateFilter =
      startDate || endDate
        ? { gte: startDate || undefined, lte: endDate || undefined }
        : undefined

    const invoices = await prisma.invoice.findMany({
      where: {
        tenantId: user.tenantId,
        clientId,
        status: { not: 'DRAFT' },
        ...(dateFilter ? { invoiceDate: dateFilter } : {}),
      },
      include: {
        payments: {
          where: { status: 'COMPLETED' },
          orderBy: { createdAt: 'asc' },
        },
        creditMemoApplications: {
          include: { creditMemo: { select: { creditMemoNumber: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { invoiceDate: 'asc' },
    })

    const transactions: TransactionRow[] = []
    for (const inv of invoices) {
      transactions.push({
        date: inv.invoiceDate,
        type: 'INVOICE',
        description: inv.title || 'Invoice',
        reference: inv.invoiceNumber,
        debit: Number(inv.total),
        credit: 0,
      })
      for (const p of inv.payments) {
        const netPaid = Number(p.amount) - Number(p.refundedAmount || 0)
        if (netPaid <= 0) continue
        transactions.push({
          date: p.processedAt || p.createdAt,
          type: 'PAYMENT',
          description: `Payment (${p.method}${p.reference ? ` - ${p.reference}` : ''})`,
          reference: inv.invoiceNumber,
          debit: 0,
          credit: netPaid,
        })
      }
      for (const app of inv.creditMemoApplications) {
        transactions.push({
          date: app.createdAt,
          type: 'CREDIT_MEMO',
          description: `Credit memo applied (${app.creditMemo.creditMemoNumber})`,
          reference: inv.invoiceNumber,
          debit: 0,
          credit: Number(app.amount),
        })
      }
    }

    transactions.sort((a, b) => a.date.getTime() - b.date.getTime())

    let runningBalance = 0
    const ledger = transactions.map((t) => {
      runningBalance += t.debit - t.credit
      return { ...t, balance: runningBalance }
    })

    const totalInvoiced = transactions.reduce((sum, t) => sum + t.debit, 0)
    const totalPaid = transactions
      .filter((t) => t.type === 'PAYMENT')
      .reduce((sum, t) => sum + t.credit, 0)
    const totalCredited = transactions
      .filter((t) => t.type === 'CREDIT_MEMO')
      .reduce((sum, t) => sum + t.credit, 0)

    const summary = {
      totalInvoiced,
      totalPaid,
      totalCredited,
      balance: runningBalance,
      invoiceCount: invoices.length,
    }

    if (format === 'csv') {
      const rows: Array<Array<string | number>> = [
        ['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
        ...ledger.map((t) => [
          t.date.toISOString().split('T')[0],
          t.type,
          t.reference,
          t.description,
          t.debit ? t.debit.toFixed(2) : '',
          t.credit ? t.credit.toFixed(2) : '',
          t.balance.toFixed(2),
        ]),
        [],
        ['Total Invoiced', totalInvoiced.toFixed(2)],
        ['Total Paid', totalPaid.toFixed(2)],
        ['Total Credited', totalCredited.toFixed(2)],
        ['Balance Due', runningBalance.toFixed(2)],
      ]
      return csvResponse(rows, `statement-${client.name.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().split('T')[0]}.csv`)
    }

    if (format === 'pdf' || format === 'html') {
      const brand = await getPdfBranding(user.tenantId)
      const html = buildCustomerStatementPdfHtml({ client, ledger, summary, startDate, endDate }, brand)
      if (format === 'html') {
        return new NextResponse(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      try {
        const pdf = await renderPdfFromHtml(html)
        return new NextResponse(pdf, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="statement-${client.name.replace(/[^a-z0-9]/gi, '-')}.pdf"`,
          },
        })
      } catch (e) {
        console.error('Customer statement PDF render failed, falling back to HTML:', e)
        return new NextResponse(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
    }

    return NextResponse.json({
      client: {
        id: client.id,
        name: client.name,
        companyName: client.companyName,
        email: client.email,
        phone: client.phone,
      },
      ledger,
      summary,
    })
  } catch (error) {
    console.error('Customer statement report error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
