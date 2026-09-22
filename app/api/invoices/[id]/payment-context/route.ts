import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'

function round2(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}

/** Context for the "new payment" editor started from an invoice: the customer
 *  and all of their open invoices (this one first, then oldest-first). */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'payments.manage')
  if (permError) return permError

  const user = getAuthUser(request)
  try {
    const current = await prisma.invoice.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true, clientId: true, client: { select: { name: true } } },
    })
    if (!current) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    const open = await prisma.invoice.findMany({
      where: {
        clientId: current.clientId,
        tenantId: user.tenantId,
        status: { notIn: ['PAID', 'CANCELLED', 'REFUNDED'] },
        balance: { gt: 0 },
      },
      select: { id: true, invoiceNumber: true, total: true, balance: true },
      orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
    })

    // Current invoice first, then the rest in oldest-first order.
    const ordered = [
      ...open.filter((i) => i.id === current.id),
      ...open.filter((i) => i.id !== current.id),
    ].map((i) => ({
      invoiceId: i.id,
      invoiceNumber: i.invoiceNumber,
      total: round2(i.total),
      balance: round2(i.balance),
    }))

    return NextResponse.json({
      clientId: current.clientId,
      clientName: current.client?.name || 'Customer',
      currentInvoiceId: current.id,
      openInvoices: ordered,
    })
  } catch (error) {
    console.error('Payment context error:', error)
    return NextResponse.json({ error: 'Failed to load payment context' }, { status: 500 })
  }
}
