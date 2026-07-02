/**
 * Event-driven QBO sync queue.
 *
 * Call `enqueueQboSync` instead of calling sync functions directly.
 * This prevents duplicate QBO API calls when the same entity changes
 * multiple times in quick succession, and provides automatic retry with
 * exponential backoff for transient failures.
 *
 * Flow:
 *   1. Business logic enqueues a job (fast, non-blocking DB write).
 *   2. Job is deduplicated: if a pending job already exists for the same
 *      (tenantId, entityType, entityId), we just touch updatedAt instead
 *      of creating a duplicate.
 *   3. By default the job is deferred to the background worker so user-facing
 *      requests (saves, webhooks) return immediately. Pass
 *      `processImmediately: true` only for explicit manual sync actions.
 *   4. After enqueue, a fire-and-forget worker nudge starts processing within
 *      seconds. The cron worker (`/api/qbo/worker`, every 5 min) handles
 *      retries with exponential backoff up to `maxRetries` times.
 */

import { prisma } from '@/lib/prisma'
import { getPublicBaseUrl } from '@/lib/public-url'
import {
  syncInvoiceToQuickBooks,
  syncClientToQuickBooks,
  syncEstimateToQuickBooks,
  syncPaymentToQuickBooks,
  syncVendorToQuickBooks,
  syncPurchaseOrderToQuickBooks,
  syncJobToQuickBooksProject,
  syncLeadToQuickBooksProject,
} from '@/lib/services/qbo-sync'

export type QboEntityType =
  | 'invoice'
  | 'client'
  | 'estimate'
  | 'payment'
  | 'vendor'
  | 'purchase_order'
  | 'job'
  | 'lead'

const RETRY_DELAYS_MS = [
  30_000,    // 30 s
  120_000,   // 2 min
  600_000,   // 10 min
]

/** Jobs stuck in `processing` longer than this are reset to `pending`. */
const STALE_PROCESSING_MS = 15 * 60 * 1000

/**
 * Enqueue a QBO sync job with deduplication.
 *
 * By default the job is processed asynchronously by the background worker so
 * callers are not blocked on QuickBooks API latency. Pass
 * `processImmediately: true` only when the caller must wait for the result
 * (e.g. manual admin sync trigger).
 */
export async function enqueueQboSync(
  tenantId: string,
  entityType: QboEntityType,
  entityId: string,
  options?: { processImmediately?: boolean }
): Promise<void> {
  const processImmediately = options?.processImmediately === true

  // Dedup: check for an existing pending job for this entity.
  const existing = await prisma.qboSyncJob.findFirst({
    where: {
      tenantId,
      entityType,
      entityId,
      status: { in: ['pending', 'processing'] },
    },
    select: { id: true },
  })

  let jobId: string

  if (existing) {
    // Coalesce: just bump updatedAt so the worker knows there's fresh intent.
    await prisma.qboSyncJob.update({
      where: { id: existing.id },
      data: { updatedAt: new Date(), nextRetryAt: new Date() },
    })
    jobId = existing.id
  } else {
    const job = await prisma.qboSyncJob.create({
      data: {
        tenantId,
        entityType,
        entityId,
        status: 'pending',
        nextRetryAt: new Date(),
      },
      select: { id: true },
    })
    jobId = job.id
  }

  if (processImmediately) {
    await processQboSyncJob(jobId)
  } else {
    nudgeQboWorker(tenantId)
  }
}

/**
 * Process a single sync job by ID.
 * Marks the job as `processing`, calls the appropriate sync function,
 * then marks it `synced`.  On failure, schedules a retry.
 */
export async function processQboSyncJob(jobId: string): Promise<void> {
  const job = await prisma.qboSyncJob.findUnique({ where: { id: jobId } })
  if (!job) return
  if (job.status === 'synced' || job.status === 'skipped') return

  // Mark processing to prevent double-execution from concurrent workers.
  await prisma.qboSyncJob.update({
    where: { id: jobId },
    data: { status: 'processing' },
  })

  try {
    await dispatchSync(job.tenantId, job.entityType as QboEntityType, job.entityId)

    await prisma.qboSyncJob.update({
      where: { id: jobId },
      data: {
        status: 'synced',
        processedAt: new Date(),
        lastError: null,
      },
    })
  } catch (err: any) {
    const nextRetry = job.retryCount < (job.maxRetries - 1)
      ? job.retryCount
      : null
    const delayMs = nextRetry !== null ? (RETRY_DELAYS_MS[nextRetry] ?? 600_000) : 0
    const isFinal = job.retryCount + 1 >= job.maxRetries

    await prisma.qboSyncJob.update({
      where: { id: jobId },
      data: {
        status: isFinal ? 'failed' : 'pending',
        retryCount: { increment: 1 },
        nextRetryAt: isFinal ? new Date() : new Date(Date.now() + delayMs),
        lastError: String(err?.message || err || 'unknown error').slice(0, 2000),
        processedAt: isFinal ? new Date() : null,
      },
    })
  }
}

/**
 * Reset jobs left in `processing` after a serverless timeout or crash.
 */
export async function resetStaleProcessingJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS)
  const result = await prisma.qboSyncJob.updateMany({
    where: {
      status: 'processing',
      updatedAt: { lt: cutoff },
    },
    data: {
      status: 'pending',
      nextRetryAt: new Date(),
      lastError: 'Reset after stale processing state (likely server timeout)',
    },
  })
  return result.count
}

/**
 * Kick off background processing without blocking the caller.
 * Uses a separate serverless invocation in production; runs inline in dev.
 */
export function nudgeQboWorker(tenantId?: string): void {
  const secret = String(process.env.CRON_SECRET || '').trim()

  if (!secret) {
    void runQboSyncWorker({ tenantId, limit: 10 }).catch((err) => {
      console.error('[QBO] Inline worker error:', err)
    })
    return
  }

  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : getPublicBaseUrl()

  void fetch(`${base}/api/qbo/worker`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tenantId }),
  }).catch((err) => {
    console.error('[QBO] Worker nudge failed:', err)
  })
}

/**
 * Background worker: process all pending jobs that are due.
 * Returns counts of processed, succeeded, and failed jobs.
 *
 * Pass `tenantId` to limit scope to a single tenant (useful for manual
 * admin retries).  Pass `limit` to cap the batch size.
 */
export async function runQboSyncWorker(options?: {
  tenantId?: string
  limit?: number
}): Promise<{ processed: number; succeeded: number; failed: number }> {
  await resetStaleProcessingJobs()

  const limit = options?.limit ?? 50

  const jobs = await prisma.qboSyncJob.findMany({
    where: {
      status: 'pending',
      nextRetryAt: { lte: new Date() },
      ...(options?.tenantId ? { tenantId: options.tenantId } : {}),
    },
    orderBy: { nextRetryAt: 'asc' },
    take: limit,
    select: { id: true },
  })

  let succeeded = 0
  let failed = 0

  for (const { id } of jobs) {
    try {
      await processQboSyncJob(id)
      // Re-fetch to check final status.
      const updated = await prisma.qboSyncJob.findUnique({
        where: { id },
        select: { status: true },
      })
      if (updated?.status === 'synced') succeeded++
      else failed++
    } catch {
      failed++
    }
  }

  return { processed: jobs.length, succeeded, failed }
}

/**
 * Retry all failed jobs for a tenant.  Used by the admin UI.
 */
export async function retryFailedQboJobs(tenantId: string): Promise<number> {
  const result = await prisma.qboSyncJob.updateMany({
    where: { tenantId, status: 'failed' },
    data: {
      status: 'pending',
      retryCount: 0,
      nextRetryAt: new Date(),
      lastError: null,
    },
  })
  return result.count
}

// ---------------------------------------------------------------------------
// Internal dispatcher — calls the correct sync function per entity type.
// ---------------------------------------------------------------------------
async function dispatchSync(
  tenantId: string,
  entityType: QboEntityType,
  entityId: string
): Promise<void> {
  switch (entityType) {
    case 'invoice':
      await syncInvoiceToQuickBooks(tenantId, entityId)
      break
    case 'client':
      await syncClientToQuickBooks(tenantId, entityId)
      break
    case 'estimate':
      await syncEstimateToQuickBooks(tenantId, entityId)
      break
    case 'payment':
      await syncPaymentToQuickBooks(tenantId, entityId)
      break
    case 'vendor':
      await syncVendorToQuickBooks(tenantId, entityId)
      break
    case 'purchase_order':
      await syncPurchaseOrderToQuickBooks(tenantId, entityId)
      break
    case 'job':
      await syncJobToQuickBooksProject(tenantId, entityId)
      break
    case 'lead':
      await syncLeadToQuickBooksProject(tenantId, entityId)
      break
    default:
      throw new Error(`Unknown QBO entity type: ${entityType}`)
  }
}
