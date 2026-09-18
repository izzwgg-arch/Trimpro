import { prisma } from '@/lib/prisma'

/**
 * Sum, per source estimate line, how much has been billed across ALL of an
 * estimate's invoices (excluding cancelled ones). Used to show a cumulative
 * "% billed" status on each invoice line: billedToDate / estimateLineTotal.
 *
 * Returns a map keyed by EstimateLineItem id → total billed (number).
 */
export async function getBilledToDateByEstimateLine(
  estimateId: string
): Promise<Map<string, number>> {
  const rows = await prisma.invoiceLineItem.groupBy({
    by: ['sourceEstimateLineItemId'],
    where: {
      sourceEstimateLineItemId: { not: null },
      isSubtotal: false,
      invoice: { estimateId, status: { not: 'CANCELLED' } },
    },
    _sum: { total: true },
  })
  const map = new Map<string, number>()
  for (const r of rows) {
    if (r.sourceEstimateLineItemId) {
      map.set(r.sourceEstimateLineItemId, Number(r._sum.total || 0))
    }
  }
  return map
}
