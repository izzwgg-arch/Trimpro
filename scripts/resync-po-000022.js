const { PrismaClient } = require('@prisma/client')
const { enqueueQboSync } = require('../lib/qbo/sync-queue')

const prisma = new PrismaClient()
const PO_ID = 'cmshnz40700blxmq4j8mdfp1x'
const TENANT_ID = 'cmkflk5ss00324egepjquq3pn'

async function main() {
  console.log('Re-syncing PO-000022...')
  await enqueueQboSync(TENANT_ID, 'purchase_order', PO_ID)
  const logs = await prisma.quickBooksSyncLog.findMany({
    where: { entityId: PO_ID, type: 'purchase_order' },
    orderBy: { createdAt: 'desc' },
    take: 3,
  })
  console.log(
    'LATEST_LOGS',
    JSON.stringify(
      logs.map((l) => ({
        action: l.action,
        status: l.status,
        qboId: l.qboId,
        error: l.error,
        createdAt: l.createdAt,
      })),
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    console.error('RESYNC_FAILED', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
