const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const CARDKNOX_FORM_URL = 'https://secure.cardknox.com/trimprony'
const LONG_URL_THRESHOLD = 2000

function firstEmail(value) {
  return String(value || '')
    .split(/[;,]/)
    .map((part) => part.trim())
    .find(Boolean) || ''
}

function compactCardknoxUrl(value) {
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

async function main() {
  const write = process.argv.includes('--write')
  const invoices = await prisma.invoice.findMany({
    where: {
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

  console.log(JSON.stringify({
    mode: write ? 'write' : 'dry-run',
    scanned: invoices.length,
    affected: affected.length,
    invoices: affected.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      balance: String(invoice.balance),
      before: invoice.currentLength,
      after: invoice.compactLength,
    })),
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
