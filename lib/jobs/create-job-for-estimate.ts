import { prisma } from '@/lib/prisma'
import { formatJobNameFromEstimate, parseJobSiteAddress } from '@/lib/jobs/ensure-job-from-invoice'
import { parseOptionalJobType } from '@/lib/jobs/types'

/**
 * New job for an estimate ("Create new" when the customer already has open jobs).
 * Named like jobs made from estimates elsewhere ("Job #123 - 12 Main St"), with the
 * estimate's job site as its address. Returns the job id.
 */
export async function createJobForEstimate(params: {
  tenantId: string
  clientId: string
  userId: string
  estimateTitle: string
  jobSiteAddress?: string | null
  jobType?: string | null
  /** Shown in the job activity line; defaults to estimate. */
  documentLabel?: 'estimate' | 'invoice'
}): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const latest = await tx.job.findFirst({
          where: { tenantId: params.tenantId, jobNumber: { startsWith: 'JOB-' } },
          orderBy: { jobNumber: 'desc' },
          select: { jobNumber: true },
        })
        const latestNum = latest?.jobNumber ? parseInt(String(latest.jobNumber).replace(/^JOB-/, ''), 10) : 0
        const jobNumber = `JOB-${String((Number.isFinite(latestNum) ? latestNum : 0) + 1 + attempt).padStart(6, '0')}`
        const job = await tx.job.create({
          data: {
            tenantId: params.tenantId,
            clientId: params.clientId,
            jobNumber,
            title: formatJobNameFromEstimate(jobNumber, params.jobSiteAddress, params.estimateTitle),
            status: 'QUOTE',
            jobType: parseOptionalJobType(params.jobType),
            priority: 3,
          },
          select: { id: true, jobNumber: true },
        })
        const site = parseJobSiteAddress(params.jobSiteAddress)
        if (site) {
          await tx.address.create({ data: { jobId: job.id, type: 'job_site', ...site } })
        }
        await tx.activity.create({
          data: {
            tenantId: params.tenantId,
            userId: params.userId,
            type: 'JOB_CREATED',
            description: `Job ${job.jobNumber} created for a new ${params.documentLabel || 'estimate'}`,
            jobId: job.id,
            clientId: params.clientId,
          },
        })
        return job.id
      })
    } catch (err: any) {
      if (err?.code === 'P2002' && err?.meta?.target?.includes?.('jobNumber')) continue
      throw err
    }
  }
  throw new Error('Unable to allocate a unique job number')
}
