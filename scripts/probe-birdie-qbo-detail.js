const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const CLIENT_ID = process.argv[2] || 'cmnfjywfp05fumc0eojrfchhw'
const INVOICE_ID = process.argv[3] || 'cmrkuoygm0bi4ffm1xm196ud8'

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: CLIENT_ID },
    select: { id: true, name: true, companyName: true, email: true, tenantId: true },
  })
  console.log('CLIENT', JSON.stringify(client, null, 2))

  const clientLogs = await prisma.quickBooksSyncLog.findMany({
    where: { entityId: CLIENT_ID },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  console.log('CLIENT_SYNC_LOGS', JSON.stringify(clientLogs, null, 2))

  const clientJobs = await prisma.qboSyncJob.findMany({
    where: { entityId: CLIENT_ID },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  console.log('CLIENT_SYNC_JOBS', JSON.stringify(clientJobs, null, 2))

  // Search sync logs mentioning birdie
  const birdieLogs = await prisma.$queryRawUnsafe(
    `SELECT id, type, action, status, "entityId", "qboId", error, "createdAt", data::text AS data_text
     FROM quickbooks_sync_logs
     WHERE data::text ILIKE '%birdie%' OR error ILIKE '%birdie%'
     ORDER BY "createdAt" DESC
     LIMIT 40`
  )
  console.log('BIRDIE_LOGS', JSON.stringify(birdieLogs, null, 2))

  const invoice = await prisma.invoice.findUnique({
    where: { id: INVOICE_ID },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      total: true,
      balance: true,
      qboSyncId: true,
      qboSyncAt: true,
      updatedAt: true,
      clientId: true,
    },
  })
  console.log('INVOICE', JSON.stringify(invoice, null, 2))

  const invJobs = await prisma.qboSyncJob.findMany({
    where: { entityId: INVOICE_ID },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  console.log('INVOICE_SYNC_JOBS', JSON.stringify(invJobs, null, 2))

  const invLogs = await prisma.quickBooksSyncLog.findMany({
    where: { entityId: INVOICE_ID },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  console.log('INVOICE_SYNC_LOGS', JSON.stringify(invLogs, null, 2))

  // Any successful client sync with qboId for this client
  const successClient = clientLogs.filter((l) => l.status === 'success' && l.qboId)
  console.log(
    'CLIENT_SYNCED',
    successClient.length > 0
      ? { synced: true, qboId: successClient[0].qboId, at: successClient[0].createdAt }
      : { synced: false }
  )
  console.log(
    'INVOICE_SYNCED',
    invoice?.qboSyncId
      ? { synced: true, qboSyncId: invoice.qboSyncId, qboSyncAt: invoice.qboSyncAt, status: invoice.status }
      : { synced: false, status: invoice?.status || null }
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
