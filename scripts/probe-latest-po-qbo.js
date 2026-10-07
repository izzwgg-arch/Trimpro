const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const pos = await prisma.purchaseOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      poNumber: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      vendorId: true,
      vendor: true,
      total: true,
      tenantId: true,
      vendorRef: { select: { id: true, name: true, email: true } },
      lineItems: {
        select: { id: true, description: true, sourceItemId: true, quantity: true, unitPrice: true },
      },
    },
  })
  console.log(
    'LATEST_POS',
    JSON.stringify(pos, (_, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.toISOString() : v), 2)
  )

  const ids = pos.map((p) => p.id)
  const tenantId = pos[0]?.tenantId

  try {
    const mappings = await prisma.qboEntityMapping.findMany({
      where: { entityType: 'purchase_order', localId: { in: ids } },
      select: { localId: true, qboId: true, updatedAt: true, integrationId: true },
    })
    console.log('MAPPINGS', JSON.stringify(mappings, (_, v) => (v instanceof Date ? v.toISOString() : v), 2))
  } catch (e) {
    console.log('MAPPINGS_ERR', e.message || String(e))
  }

  try {
    const jobs = await prisma.qboSyncJob.findMany({
      where: { entityType: 'purchase_order' },
      orderBy: { createdAt: 'desc' },
      take: 15,
    })
    console.log('JOBS', JSON.stringify(jobs, (_, v) => (v instanceof Date ? v.toISOString() : v), 2))
  } catch (e) {
    console.log('JOBS_ERR', e.message || String(e))
  }

  if (tenantId) {
    try {
      const vendorMaps = await prisma.qboEntityMapping.findMany({
        where: {
          entityType: 'vendor',
          localId: { in: pos.map((p) => p.vendorId).filter(Boolean) },
        },
      })
      console.log('VENDOR_MAPS', JSON.stringify(vendorMaps, (_, v) => (v instanceof Date ? v.toISOString() : v), 2))
    } catch (e) {
      console.log('VENDOR_MAPS_ERR', e.message || String(e))
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
