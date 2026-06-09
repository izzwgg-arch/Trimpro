import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const CARDKNOX_FORM_URL = 'https://secure.cardknox.com/trimprony'
const LONG_URL_THRESHOLD = 2000

function firstEmail(value: string | null) {
  return String(value || '')
    .split(/[;,]/)
    .map((part) => part.trim())
    .find(Boolean) || ''
}

function compactCardknoxUrl(value: string) {
  const source = new URL(value)
  const target = new URL(CARDKNOX_FORM_URL)

  const copiedKeys = [
    'xInvoice',
    'xAmount',
    'xDescription',
    'xCustom1',
    'xName',
    'xPhone',
    'xBillStreet',
    'xBillCity',
    'xBillState',
    'xBillZip',
    'xBillCountry',
    'xBillPhone',
    'xAddress',
    'xCity',
    'xState',
    'xZip',
    'xCountry',
    'xReturnURL',
    'xRedirectURL',
    'xWebhookURL',
  ]

  for (const key of copiedKeys) {
    const current = source.searchParams.get(key)
    if (current) target.searchParams.set(key, current)
  }

  const email = firstEmail(source.searchParams.get('xEmail') || source.searchParams.get('customer_email'))
  if (email) target.searchParams.set('xEmail', email)

  return target.toString()
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  if (user.role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Admin access required to run this repair tool' },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const write = Boolean(body?.write)

  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId: user.tenantId,
      solaPaymentUrl: {
        startsWith: `${CARDKNOX_FORM_URL}?`,
      },
    },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      balance: true,
      solaPaymentUrl: true,
    },
    orderBy: {
      invoiceNumber: 'desc',
    },
  })

  const affected = invoices
    .map((invoice) => {
      const currentUrl = invoice.solaPaymentUrl || ''
      const compactUrl = compactCardknoxUrl(currentUrl)
      return {
        ...invoice,
        currentLength: currentUrl.length,
        compactLength: compactUrl.length,
        compactUrl,
      }
    })
    .filter((invoice) => invoice.currentLength >= LONG_URL_THRESHOLD && invoice.compactLength < invoice.currentLength)

  if (write) {
    for (const invoice of affected) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { solaPaymentUrl: invoice.compactUrl },
      })
    }
  }

  return NextResponse.json({
    mode: write ? 'write' : 'dry-run',
    scanned: invoices.length,
    affected: affected.length,
    invoices: affected.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      balance: invoice.balance.toString(),
      before: invoice.currentLength,
      after: invoice.compactLength,
    })),
  })
}
