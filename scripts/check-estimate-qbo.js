const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const EST = 'EST-839496'

async function main() {
  const est = await prisma.estimate.findFirst({
    where: { estimateNumber: EST },
    include: {
      client: { select: { id: true, name: true } },
      lineItems: { select: { id: true, description: true } },
    },
  })

  if (!est) {
    console.log('ESTIMATE_NOT_FOUND')
    return
  }

  console.log('=== ESTIMATE ===')
  console.log(
    JSON.stringify(
      {
        id: est.id,
        estimateNumber: est.estimateNumber,
        status: est.status,
        clientId: est.clientId,
        clientName: est.client?.name,
        tenantId: est.tenantId,
        total: String(est.total),
        lineItemCount: est.lineItems.length,
      },
      null,
      2
    )
  )

  const qbo = await prisma.quickBooksIntegration.findUnique({ where: { tenantId: est.tenantId } })
  const conn = await prisma.integrationConnection.findUnique({
    where: { tenantId_provider: { tenantId: est.tenantId, provider: 'quickbooks' } },
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

  const estLogs = await prisma.quickBooksSyncLog.findMany({
    where: { entityId: est.id, type: 'estimate' },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  console.log('=== ESTIMATE SYNC LOGS ===')
  console.log(JSON.stringify(estLogs, null, 2))

  if (est.clientId) {
    const clientLogs = await prisma.quickBooksSyncLog.findMany({
      where: { entityId: est.clientId, type: 'client' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    console.log('=== CLIENT SYNC LOGS ===')
    console.log(JSON.stringify(clientLogs, null, 2))
  }

  const jobs = await prisma.qboSyncJob.findMany({
    where: { entityType: 'estimate', entityId: est.id },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  })
  console.log('=== SYNC JOBS ===')
  console.log(JSON.stringify(jobs, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
