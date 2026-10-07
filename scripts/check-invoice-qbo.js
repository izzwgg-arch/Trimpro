const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const INVOICE = process.argv[2] || '000542'

async function main() {
  const candidates = [INVOICE, `INV-${INVOICE}`, `INV-${INVOICE.replace(/^INV-/, '')}`]
  const invoice = await prisma.invoice.findFirst({
    where: {
      OR: [
        ...candidates.map((invoiceNumber) => ({ invoiceNumber })),
        { id: INVOICE },
      ],
    },
    include: {
      client: { select: { id: true, name: true } },
      lineItems: { select: { id: true, description: true } },
    },
  })

  if (!invoice) {
    console.log('INVOICE_NOT_FOUND', INVOICE)
    return
  }

  console.log('=== INVOICE ===')
  console.log(
    JSON.stringify(
      {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        clientId: invoice.clientId,
        clientName: invoice.client?.name,
        tenantId: invoice.tenantId,
        total: String(invoice.total),
        qboSyncId: invoice.qboSyncId,
        qboSyncAt: invoice.qboSyncAt,
        lineItemCount: invoice.lineItems.length,
        updatedAt: invoice.updatedAt,
      },
      null,
      2
    )
  )

  const qbo = await prisma.quickBooksIntegration.findUnique({ where: { tenantId: invoice.tenantId } })
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId: invoice.tenantId, provider: 'quickbooks' } },
  })

  console.log('=== QBO INTEGRATION ===')
  console.log(
    JSON.stringify(
      {
        isConnected: qbo?.isConnected,
        hasRealm: !!qbo?.realmId,
        serviceItemId: qbo?.serviceItemId,
        connStatus: conn?.status,
        connError: conn?.lastError,
      },
      null,
      2
    )
  )

  const invoiceLogs = await prisma.quickBooksSyncLog.findMany({
    where: { entityId: invoice.id, type: 'invoice' },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  console.log('=== INVOICE SYNC LOGS ===')
  console.log(JSON.stringify(invoiceLogs, null, 2))

  if (invoice.clientId) {
    const clientLogs = await prisma.quickBooksSyncLog.findMany({
      where: { entityId: invoice.clientId, type: 'client' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })
    console.log('=== CLIENT SYNC LOGS ===')
    console.log(JSON.stringify(clientLogs, null, 2))
  }

  const jobs = await prisma.qboSyncJob.findMany({
    where: { entityType: 'invoice', entityId: invoice.id },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  })
  console.log('=== INVOICE SYNC JOBS ===')
  console.log(JSON.stringify(jobs, null, 2))

  const latestLog = invoiceLogs[0]
  const latestJob = jobs[0]
  let state = 'not_synced'
  if (invoice.qboSyncId) state = 'synced'
  else if (latestJob?.status === 'pending' || latestJob?.status === 'processing') state = 'in_progress'
  else if (latestJob?.status === 'failed' || latestLog?.status === 'error') state = 'failed'
  else if (latestLog?.status === 'success') state = 'synced'
  else if (!qbo?.isConnected) state = 'no_qbo_connection'

  console.log('=== SUMMARY ===')
  console.log(
    JSON.stringify(
      {
        invoiceNumber: invoice.invoiceNumber,
        state,
        qboSyncId: invoice.qboSyncId,
        latestLogStatus: latestLog?.status ?? null,
        latestLogError: latestLog?.error ?? null,
        latestJobStatus: latestJob?.status ?? null,
        latestJobError: latestJob?.lastError ?? null,
      },
      null,
      2
    )
  )
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
