const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const poId = 'cmshnz40700blxmq4j8mdfp1x' // PO-000022
  const vendorId = 'cmo1no5m500cp2dxunntao1q2'

  // Discover mapping-ish tables
  const keys = Object.keys(prisma).filter((k) => /map|qbo|sync|quick/i.test(k) && !k.startsWith('_') && !k.startsWith('$'))
  console.log('PRISMA_KEYS', keys)

  const integration = await prisma.quickBooksIntegration.findFirst({
    where: { tenantId: 'cmkflk5ss00324egepjquq3pn' },
  })
  console.log(
    'INTEGRATION',
    JSON.stringify(
      integration && {
        id: integration.id,
        tenantId: integration.tenantId,
        realmId: integration.realmId,
        isActive: integration.isActive,
        lastSyncAt: integration.lastSyncAt,
      },
      (_, v) => (v instanceof Date ? v.toISOString() : v),
      2
    )
  )

  const logs = await prisma.quickBooksSyncLog.findMany({
    where: {
      OR: [{ entityId: poId }, { entityId: vendorId }, { type: { contains: 'purchase', mode: 'insensitive' } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  console.log(
    'SYNC_LOGS',
    JSON.stringify(logs, (_, v) => (v instanceof Date ? v.toISOString() : v), 2)
  )

  // Raw SQL for mappings if table exists
  try {
    const maps = await prisma.$queryRawUnsafe(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name ILIKE '%qbo%'
      ORDER BY table_name
    `)
    console.log('QBO_TABLES', JSON.stringify(maps, null, 2))
  } catch (e) {
    console.log('TABLE_LIST_ERR', e.message)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
