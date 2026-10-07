const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const q = process.argv[2] || 'birdie'
  const clients = await prisma.client.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      companyName: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
    take: 50,
  })

  console.log('=== CLIENTS MATCHING', JSON.stringify(q), '===')
  console.log(JSON.stringify(clients, null, 2))

  const mapTables = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%qbo%' OR table_name ILIKE '%map%' OR table_name ILIKE '%sync%') ORDER BY 1`
  )
  console.log('MAP_TABLES', JSON.stringify(mapTables))

  for (const c of clients) {
    const maps = await prisma.$queryRawUnsafe(
      `SELECT * FROM integration_entity_maps WHERE "entityId" = $1 LIMIT 20`,
      c.id
    ).catch(async () => {
      return prisma.$queryRawUnsafe(
        `SELECT column_name, table_name FROM information_schema.columns WHERE table_schema='public' AND column_name ILIKE '%entity%' ORDER BY table_name, column_name`
      )
    })
    console.log('MAPS_FOR', c.id, JSON.stringify(maps, null, 2))

    const invoices = await prisma.invoice.findMany({
      where: { clientId: c.id },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        total: true,
        balance: true,
        qboSyncId: true,
        qboSyncAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    })
    console.log('INVOICES_FOR', c.name || c.id, JSON.stringify(invoices, null, 2))

    const estimates = await prisma.estimate.findMany({
      where: { clientId: c.id },
      select: {
        id: true,
        estimateNumber: true,
        status: true,
        total: true,
        qboSyncId: true,
        qboSyncAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    })
    console.log('ESTIMATES_FOR', c.name || c.id, JSON.stringify(estimates, null, 2))

    const jobs = await prisma.job.findMany({
      where: { clientId: c.id },
      select: { id: true, title: true, jobNumber: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    })
    console.log('JOBS_FOR', c.name || c.id, JSON.stringify(jobs, null, 2))
  }

  const jobsDirect = await prisma.job.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { jobNumber: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      title: true,
      jobNumber: true,
      status: true,
      clientId: true,
      client: { select: { id: true, name: true, companyName: true } },
    },
    take: 30,
  })
  console.log('JOBS_DIRECT', JSON.stringify(jobsDirect, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
