/**
 * Backfill jobs for invoices that were created FROM AN ESTIMATE in the last 8
 * weeks but never got a linked job (e.g. created via the public customer
 * estimate-approval flow before that path auto-created jobs).
 *
 * Dry run by default. Pass --apply to actually create/link jobs.
 * Uses the idempotent ensureJobFromInvoice helper, so it is safe to re-run.
 *
 * Run: npx tsx scripts/backfill-jobs-from-estimate-invoices.mjs [--apply] [--limit=500] [--weeks=8]
 */
import { PrismaClient } from '@prisma/client'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  })
)
const apply = args.apply === 'true'
const limit = Number(args.limit || 500)
const weeks = Number(args.weeks || 8)
const cutoff = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000)

const p = new PrismaClient()

const candidates = await p.invoice.findMany({
  where: {
    estimateId: { not: null },
    jobId: null,
    createdAt: { gte: cutoff },
    status: { notIn: ['CANCELLED', 'REFUNDED'] },
  },
  orderBy: { createdAt: 'desc' },
  take: limit,
  select: {
    id: true,
    invoiceNumber: true,
    status: true,
    createdAt: true,
    client: { select: { name: true } },
    estimate: { select: { estimateNumber: true, jobId: true } },
  },
})

console.log(`Cutoff: invoices created on/after ${cutoff.toISOString()} (${weeks} weeks)`)
console.log(`Found ${candidates.length} estimate-sourced invoice(s) without a job (limit ${limit})`)
console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`)

if (!apply) {
  console.log(
    JSON.stringify(
      candidates.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        client: inv.client?.name,
        createdAt: inv.createdAt,
        estimate: inv.estimate?.estimateNumber,
        estimateHasJob: Boolean(inv.estimate?.jobId),
      })),
      null,
      2
    )
  )
  await p.$disconnect()
  process.exit(0)
}

// Dynamic import so this script runs on the server once the lib is deployed.
const { ensureJobFromInvoice } = await import('../lib/jobs/ensure-job-from-invoice.ts')

let created = 0
let linked = 0
let skipped = 0
let failed = 0

for (const inv of candidates) {
  try {
    const result = await ensureJobFromInvoice(inv.id)
    if (result.created && result.job) {
      created += 1
      console.log(`CREATED ${inv.invoiceNumber} -> ${result.job.jobNumber}`)
    } else if (result.job) {
      linked += 1
      console.log(`LINKED  ${inv.invoiceNumber} -> ${result.job.jobNumber}`)
    } else {
      skipped += 1
      console.log(`SKIP    ${inv.invoiceNumber} (${result.skippedReason || 'no job'})`)
    }
  } catch (error) {
    failed += 1
    console.error(`FAIL    ${inv.invoiceNumber}`, error)
  }
}

console.log(JSON.stringify({ created, linked, skipped, failed }, null, 2))
await p.$disconnect()
