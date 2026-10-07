/**
 * Remap TrimPro client "11 Birdie Dr" from stale QBO id 1414 -> 1735,
 * then requeue INV-000542 sync.
 */
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const CLIENT_ID = 'cmnfjywfp05fumc0eojrfchhw'
const CORRECT_QBO_ID = '1735'
const INVOICE_ID = 'cmrkuoygm0bi4ffm1xm196ud8'
const INTEGRATION_ID = 'cmmkqf8ss000t1hitcc8guu1g'
const TENANT_ID = 'cmkflk5ss00324egepjquq3pn'

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: CLIENT_ID },
    select: { id: true, name: true, tenantId: true },
  })
  if (!client) throw new Error('Client not found')
  console.log('CLIENT', client)

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
  console.log('MAPPED_BEFORE', before ? { qboId: before.qboId, action: before.action, at: before.createdAt } : null)

  const link = await prisma.quickBooksSyncLog.create({
    data: {
      integrationId: INTEGRATION_ID,
      type: 'client',
      action: 'link',
      status: 'success',
      entityId: CLIENT_ID,
      qboId: CORRECT_QBO_ID,
      data: {
        matchedDisplayName: client.name,
        reason: 'manual_relink_stale_1414_to_1735',
        previousQboId: before?.qboId || null,
      },
    },
  })
  console.log('LINKED', { id: link.id, qboId: link.qboId })

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
  console.log('MAPPED_AFTER', after ? { qboId: after.qboId, action: after.action, at: after.createdAt } : null)

  // Reset invoice sync jobs so they can run again
  const updatedJobs = await prisma.qboSyncJob.updateMany({
    where: {
      tenantId: TENANT_ID,
      entityType: 'invoice',
      entityId: INVOICE_ID,
      status: { in: ['pending', 'failed', 'processing'] },
    },
    data: {
      status: 'pending',
      retryCount: 0,
      nextRetryAt: new Date(),
      lastError: null,
      processedAt: null,
    },
  })
  console.log('INVOICE_JOBS_RESET', updatedJobs.count)

  const existingPending = await prisma.qboSyncJob.findFirst({
    where: {
      tenantId: TENANT_ID,
      entityType: 'invoice',
      entityId: INVOICE_ID,
      status: 'pending',
    },
  })
  if (!existingPending) {
    const created = await prisma.qboSyncJob.create({
      data: {
        tenantId: TENANT_ID,
        entityType: 'invoice',
        entityId: INVOICE_ID,
        actionType: 'sync',
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
        nextRetryAt: new Date(),
        payloadHash: `invoice-sync:${INVOICE_ID}`,
      },
    })
    console.log('INVOICE_JOB_CREATED', created.id)
  } else {
    console.log('INVOICE_JOB_PENDING', existingPending.id)
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: INVOICE_ID },
    select: { invoiceNumber: true, status: true, qboSyncId: true, qboSyncAt: true },
  })
  console.log('INVOICE_NOW', invoice)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
