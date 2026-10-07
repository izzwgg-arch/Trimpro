require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

;(async () => {
  const id = 'cmnfjysn904vcmc0ed03foq2z'
  const client = await p.client.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      _count: { select: { invoices: true, jobs: true, estimates: true } },
    },
  })
  console.log('client', client)

  const inv = await p.invoice.findMany({
    where: { clientId: id },
    select: { id: true, invoiceNumber: true, status: true, total: true, balance: true },
  })
  console.log('invoices', inv)

  // Import deployed fetch if possible
  try {
    const { fetchClientDocuments } = require('../lib/documents/unified-documents.ts')
    console.log('direct require skipped')
  } catch {}

  await p.$disconnect()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
