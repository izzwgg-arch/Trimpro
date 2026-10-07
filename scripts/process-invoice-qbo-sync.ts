import { PrismaClient } from '@prisma/client'
import { processQboSyncJob } from '@/lib/qbo/sync-queue'

const prisma = new PrismaClient()
const INVOICE_ID = process.argv[2] || 'cmrkuoygm0bi4ffm1xm196ud8'

async function main() {
  const jobs = await prisma.qboSyncJob.findMany({
    where: {
      entityType: 'invoice',
      entityId: INVOICE_ID,
      status: { in: ['pending', 'failed'] },
    },
    orderBy: { updatedAt: 'desc' },
  })
  console.log(
    'JOBS',
    jobs.map((j) => ({ id: j.id, status: j.status, retryCount: j.retryCount, lastError: j.lastError }))
  )

  for (const job of jobs) {
    if (job.status === 'failed') {
      await prisma.qboSyncJob.update({
        where: { id: job.id },
        data: { status: 'pending', retryCount: 0, nextRetryAt: new Date(), lastError: null, processedAt: null },
      })
    }
    console.log('PROCESSING', job.id)
    await processQboSyncJob(job.id)
    const after = await prisma.qboSyncJob.findUnique({ where: { id: job.id } })
    console.log('AFTER_JOB', {
      id: after?.id,
      status: after?.status,
      lastError: after?.lastError,
      processedAt: after?.processedAt,
    })
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: INVOICE_ID },
    select: { invoiceNumber: true, status: true, qboSyncId: true, qboSyncAt: true },
  })
  console.log('INVOICE', invoice)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
