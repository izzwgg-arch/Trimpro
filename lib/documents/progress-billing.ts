/**
 * Pure helpers for progress/percentage billing math.
 *
 * All monetary arithmetic is done in integer cents to avoid floating-point
 * accumulation errors. The core invariant we enforce:
 *
 *   sum(invoiceTotals) <= estimateTotal   (never over-bill)
 *
 * The "final invoice reconciliation" adjusts the last billable line item so
 * that the cumulative invoiced amount equals the estimate total exactly.
 */

/** Monetary line item as seen by the reconciler. */
export type ReconcilableLine = {
  total: number
  unitPrice: number
  quantity: number
  isSubtotal?: boolean
}

/** Result of a reconciliation pass. */
export type ReconcileResult<T extends ReconcilableLine> = {
  /** Adjusted line items (last billable line reduced to absorb rounding excess). */
  lineItems: T[]
  /** New subtotal in cents (= sum of adjusted line totals). */
  subtotalCents: number
  /** New tax amount in whole cents. */
  taxCents: number
  /** New invoice total in whole cents (= subtotalCents + taxCents). */
  totalCents: number
  /** True when reconciliation was needed and performed. */
  wasReconciled: boolean
}

/** Convert a dollar amount to integer cents (half-up rounding). */
export function toCents(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100)
}

/** Convert integer cents back to a 2-decimal-place dollar number. */
export function fromCents(cents: number): number {
  return Number((cents / 100).toFixed(2))
}

/**
 * Find the unique `subtotalCents` value s such that:
 *   s + Math.round(s * taxRate) === targetTotalCents
 *
 * Searches ±3 around the analytic estimate. Returns null if no solution is
 * found in that neighbourhood (should never happen for realistic tax rates).
 */
export function solveSubtotalForTotal(
  targetTotalCents: number,
  taxRate: number
): { subtotalCents: number; taxCents: number } | null {
  if (taxRate <= 0) {
    return { subtotalCents: targetTotalCents, taxCents: 0 }
  }
  const approx = Math.round(targetTotalCents / (1 + taxRate))
  for (let delta = -3; delta <= 3; delta++) {
    const s = approx + delta
    if (s < 0) continue
    const t = Math.round(s * taxRate)
    if (s + t === targetTotalCents) {
      return { subtotalCents: s, taxCents: t }
    }
  }
  return null
}

/**
 * Reconcile a set of progress-billing line items so that the invoice total
 * does not exceed `maxAllowedCents`.
 *
 * Call this ONLY when `currentTotalCents > maxAllowedCents`. The function
 * reduces the last non-subtotal line item (working backwards) until the
 * excess is absorbed.
 *
 * @param lines            Invoice line items (as computed by per-line rounding).
 * @param currentSubtotalCents  Sum of toCents(line.total) for all non-subtotal lines.
 * @param taxRate          Fractional tax rate (e.g. 0.0875 for 8.75 %).
 * @param maxAllowedCents  Maximum invoice total allowed in integer cents.
 */
export function reconcileProgressLines<T extends ReconcilableLine>(
  lines: readonly T[],
  currentSubtotalCents: number,
  taxRate: number,
  maxAllowedCents: number
): ReconcileResult<T> {
  const currentTaxCents = Math.round(currentSubtotalCents * taxRate)
  const currentTotalCents = currentSubtotalCents + currentTaxCents

  if (currentTotalCents <= maxAllowedCents) {
    // Nothing to do.
    return {
      lineItems: [...lines],
      subtotalCents: currentSubtotalCents,
      taxCents: currentTaxCents,
      totalCents: currentTotalCents,
      wasReconciled: false,
    }
  }

  // Find the target subtotal that, together with its rounded tax, equals maxAllowedCents.
  const solved = solveSubtotalForTotal(maxAllowedCents, taxRate)
  const targetSubtotalCents = solved?.subtotalCents ?? Math.round(maxAllowedCents / (1 + taxRate))
  const targetTaxCents = solved?.taxCents ?? (maxAllowedCents - targetSubtotalCents)
  const targetTotalCents = targetSubtotalCents + targetTaxCents

  const excessSubtotalCents = currentSubtotalCents - targetSubtotalCents
  if (excessSubtotalCents <= 0) {
    // Excess was entirely in tax rounding — adjust tax directly.
    return {
      lineItems: [...lines],
      subtotalCents: currentSubtotalCents,
      taxCents: targetTaxCents,
      totalCents: targetTotalCents,
      wasReconciled: true,
    }
  }

  // Reduce the last non-subtotal line(s) until the excess is absorbed.
  const finalLines = [...lines] as T[]
  let remaining = excessSubtotalCents

  for (let i = finalLines.length - 1; i >= 0 && remaining > 0; i--) {
    const line = finalLines[i]
    if (line.isSubtotal) continue

    const lineCents = toCents(line.total)
    const reduction = Math.min(lineCents, remaining)
    const newLineCents = lineCents - reduction
    const newLineTotal = fromCents(newLineCents)
    const newUnitPrice =
      line.quantity > 0 ? Number((newLineTotal / line.quantity).toFixed(4)) : newLineTotal

    finalLines[i] = { ...line, total: newLineTotal, unitPrice: newUnitPrice }
    remaining -= reduction
  }

  if (remaining !== 0) {
    // Could not fully absorb — return best-effort (assertion guard will catch true over-billing).
    const bestSubtotal = currentSubtotalCents - (excessSubtotalCents - remaining)
    const bestTax = Math.round(bestSubtotal * taxRate)
    return {
      lineItems: finalLines,
      subtotalCents: bestSubtotal,
      taxCents: bestTax,
      totalCents: bestSubtotal + bestTax,
      wasReconciled: true,
    }
  }

  return {
    lineItems: finalLines,
    subtotalCents: targetSubtotalCents,
    taxCents: targetTaxCents,
    totalCents: targetTotalCents,
    wasReconciled: true,
  }
}

/**
 * High-level helper: given the per-line-rounded subtotal (in cents), the tax
 * rate, and the existing invoiced total + estimate total, return the values to
 * use for the invoice — reconciling if needed.
 */
export function computeProgressInvoiceTotals(params: {
  subtotalCents: number
  taxRate: number
  estimateTotalCents: number
  existingInvoicedCents: number
  lines: readonly ReconcilableLine[]
}): {
  subtotalCents: number
  taxCents: number
  totalCents: number
  lineItems: ReconcilableLine[]
  wasReconciled: boolean
} {
  const { subtotalCents, taxRate, estimateTotalCents, existingInvoicedCents, lines } = params
  const taxCents = Math.round(subtotalCents * taxRate)
  const totalCents = subtotalCents + taxCents
  const maxAllowedCents = Math.max(0, estimateTotalCents - existingInvoicedCents)

  if (totalCents <= maxAllowedCents) {
    return { subtotalCents, taxCents, totalCents, lineItems: [...lines], wasReconciled: false }
  }

  const result = reconcileProgressLines(lines, subtotalCents, taxRate, maxAllowedCents)
  return {
    subtotalCents: result.subtotalCents,
    taxCents: result.taxCents,
    totalCents: result.totalCents,
    lineItems: result.lineItems,
    wasReconciled: result.wasReconciled,
  }
}
