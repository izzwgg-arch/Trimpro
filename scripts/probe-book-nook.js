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
      _count: {
        select: {
          jobs: true,
          invoices: true,
          estimates: true,
          addresses: true,
          contacts: true,
        },
      },
    },
  })
  const children = await p.client.findMany({
    where: { parentId: id },
    select: { id: true, name: true },
  })
  console.log('client', client)
  console.log('children', children)

  const invoices = await p.invoice.findMany({
    where: { clientId: { in: [id, ...children.map((c) => c.id)] } },
    select: { id: true, invoiceNumber: true, clientId: true, title: true, status: true },
  })
  const estimates = await p.estimate.findMany({
    where: { clientId: { in: [id, ...children.map((c) => c.id)] } },
    select: { id: true, estimateNumber: true, clientId: true, title: true, status: true },
  })
  const jobs = await p.job.findMany({
    where: { clientId: { in: [id, ...children.map((c) => c.id)] } },
    select: { id: true, jobNumber: true, clientId: true, title: true, status: true },
  })
  console.log('invoices', invoices)
  console.log('estimates', estimates)
  console.log('jobs', jobs)

  // Check attachment model fields
  const sample = await p.attachment.findFirst({ select: { id: true } }).catch((e) => {
    console.log('attachment findFirst err', e.message)
    return null
  })
  console.log('has attachments table access', Boolean(sample) || sample === null)

  await p.$disconnect()
})().catch(async (e) => {
  console.error(e)
  await p.$disconnect()
  process.exit(1)
})
