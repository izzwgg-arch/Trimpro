const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const logs = await prisma.quickBooksSyncLog.findMany({
    where: {
      createdAt: { gte: since },
      OR: [
        { error: { contains: '6240' } },
        { error: { contains: 'Duplicate Name', mode: 'insensitive' } },
        { error: { contains: 'name supplied already exists', mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
  })

  console.log('RECENT_6240_LOGS', logs.length)

  const byEntity = new Map()
  for (const log of logs) {
    const key = `${log.type}:${log.entityId || 'none'}`
    if (!byEntity.has(key)) byEntity.set(key, [])
    byEntity.get(key).push(log)
  }

  for (const [key, rows] of byEntity) {
    const latest = rows[0]
    let local = null
    if (latest.entityId && latest.type === 'client') {
      local = await prisma.client.findUnique({
        where: { id: latest.entityId },
        select: { id: true, name: true, companyName: true, parentId: true },
      })
    } else if (latest.entityId && latest.type === 'invoice') {
      local = await prisma.invoice.findUnique({
        where: { id: latest.entityId },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          qboSyncId: true,
          client: { select: { id: true, name: true } },
        },
      })
    } else if (latest.entityId && latest.type === 'estimate') {
      local = await prisma.estimate.findUnique({
        where: { id: latest.entityId },
        select: {
          id: true,
          estimateNumber: true,
          status: true,
          client: { select: { id: true, name: true } },
        },
      })
    }

    const mapped = latest.entityId
      ? await prisma.quickBooksSyncLog.findFirst({
          where: {
            type: 'client',
            entityId: latest.type === 'client' ? latest.entityId : local?.client?.id || local?.id,
            status: 'success',
            qboId: { not: null },
          },
          orderBy: { createdAt: 'desc' },
          select: { qboId: true, action: true, createdAt: true },
        })
      : null

    // For invoice failures, also get client mapping
    let clientMapped = null
    let clientId = null
    if (latest.type === 'invoice' && local?.client?.id) {
      clientId = local.client.id
      clientMapped = await prisma.quickBooksSyncLog.findFirst({
        where: {
          type: 'client',
          entityId: clientId,
          status: 'success',
          qboId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { qboId: true, action: true, createdAt: true, data: true },
      })
      const clientFail = await prisma.quickBooksSyncLog.findFirst({
        where: {
          type: 'client',
          entityId: clientId,
          status: 'error',
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        select: { qboId: true, error: true, createdAt: true, action: true },
      })
      console.log(
        JSON.stringify(
          {
            key,
            count: rows.length,
            latestAt: latest.createdAt,
            latestAction: latest.action,
            latestStatus: latest.status,
            qboIdOnError: latest.qboId,
            error: latest.error,
            local,
            clientMapped,
            clientFail,
          },
          null,
          2
        )
      )
      continue
    }

    console.log(
      JSON.stringify(
        {
          key,
          count: rows.length,
          latestAt: latest.createdAt,
          latestAction: latest.action,
          latestStatus: latest.status,
          qboIdOnError: latest.qboId,
          error: latest.error,
          local,
          mappedSuccess: mapped,
        },
        null,
        2
      )
    )
  }

  const jobs = await prisma.qboSyncJob.findMany({
    where: {
      updatedAt: { gte: since },
      OR: [
        { lastError: { contains: '6240' } },
        { lastError: { contains: 'Duplicate Name', mode: 'insensitive' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  })
  console.log(
    'PENDING_FAILED_JOBS',
    JSON.stringify(
      jobs.map((j) => ({
        id: j.id,
        entityType: j.entityType,
        entityId: j.entityId,
        status: j.status,
        retryCount: j.retryCount,
        updatedAt: j.updatedAt,
        lastError: j.lastError,
      })),
      null,
      2
    )
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
