/**
 * Remap client 51 Hodson point from stale QBO 1039 -> 2014,
 * then requeue/process related invoice + estimate syncs.
 */
import { PrismaClient } from '@prisma/client'
import { processQboSyncJob } from '@/lib/qbo/sync-queue'

const prisma = new PrismaClient()

const CLIENT_ID = 'cmnfjys3v04somc0efcz9pfsc'
const CORRECT_QBO_ID = '2014'
const INTEGRATION_ID = 'cmmkqf8ss000t1hitcc8guu1g'
const TENANT_ID = 'cmkflk5ss00324egepjquq3pn'
const ENTITY_IDS = [
  'cmsrohdsr04ki13vjbwgbd8g8', // INV-000630
  'cmr3vyrdq00oic3ozly9gmjjm', // EST-008892
  'cmsozj7sr036icwbb59if3fj0', // EST-839666
]

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: CLIENT_ID },
    select: { id: true, name: true },
  })
  if (!client) throw new Error('client not found')

  const before = await prisma.quickBooksSyncLog.findFirst({
    where: {
      integrationId: INTEGRATION_ID,
      type: 'client',
      entityId: CLIENT_ID,
      status: 'success',
      qboId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  })
  console.log('MAPPED_BEFORE', before ? { qboId: before.qboId, action: before.action } : null)

  await prisma.quickBooksSyncLog.create({
    data: {
      integrationId: INTEGRATION_ID,
      type: 'client',
      action: 'link',
      status: 'success',
      entityId: CLIENT_ID,
      qboId: CORRECT_QBO_ID,
      data: {
        matchedDisplayName: client.name,
        reason: 'manual_relink_stale_1039_to_2014',
        previousQboId: before?.qboId || null,
        note: '1039 is lieby huss; 2014 is 51 Hodson point',
      },
    },
  })

  const after = await prisma.quickBooksSyncLog.findFirst({
    where: {
      integrationId: INTEGRATION_ID,
      type: 'client',
      entityId: CLIENT_ID,
      status: 'success',
      qboId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  })
  console.log('MAPPED_AFTER', after ? { qboId: after.qboId, action: after.action } : null)

  for (const entityId of ENTITY_IDS) {
    const jobs = await prisma.qboSyncJob.findMany({
      where: {
        tenantId: TENANT_ID,
        entityId,
        status: { in: ['pending', 'failed', 'processing'] },
      },
      orderBy: { updatedAt: 'desc' },
    })

    if (!jobs.length) {
      // invent entity type from first known
      const invoice = await prisma.invoice.findUnique({ where: { id: entityId }, select: { id: true } })
      const entityType = invoice ? 'invoice' : 'estimate'
      const created = await prisma.qboSyncJob.create({
        data: {
          tenantId: TENANT_ID,
          entityType,
          entityId,
          actionType: 'sync',
          status: 'pending',
          retryCount: 0,
          maxRetries: 3,
          nextRetryAt: new Date(),
          payloadHash: `${entityType}-sync:${entityId}`,
        },
      })
      console.log('CREATED_JOB', created.id, entityType, entityId)
      await processQboSyncJob(created.id)
      const done = await prisma.qboSyncJob.findUnique({ where: { id: created.id } })
      console.log('RESULT', { id: done?.id, status: done?.status, lastError: done?.lastError })
      continue
    }

    for (const job of jobs) {
      await prisma.qboSyncJob.update({
        where: { id: job.id },
        data: {
          status: 'pending',
          retryCount: 0,
          nextRetryAt: new Date(),
          lastError: null,
          processedAt: null,
        },
      })
      console.log('PROCESSING', job.id, job.entityType, entityId)
      await processQboSyncJob(job.id)
      const done = await prisma.qboSyncJob.findUnique({ where: { id: job.id } })
      console.log('RESULT', { id: done?.id, status: done?.status, lastError: done?.lastError })
    }
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: 'cmsrohdsr04ki13vjbwgbd8g8' },
    select: { invoiceNumber: true, status: true, qboSyncId: true, qboSyncAt: true },
  })
  console.log('INVOICE_000630', invoice)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
