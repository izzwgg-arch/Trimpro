/**
 * Shared math for "PERCENT_OF_ABOVE" catalog items — a normal line item whose
 * price is calculated, at the moment it's added, as a percentage of the
 * dollar total of the real line items already listed above it in the same
 * document (estimate/invoice/purchase order).
 */

type PrecedingLine = {
  quantity?: string | number | null
  unitPrice?: string | number | null
  isSubtotal?: boolean
  isNote?: boolean
  isGroupHeader?: boolean
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const n = parseFloat(String(value ?? ''))
  return Number.isFinite(n) ? n : 0
}

/** Sums the real (non-divider) line items — the "items above" a percent line. */
export function sumPrecedingLineItems(lines: readonly PrecedingLine[]): number {
  return lines.reduce((sum, li) => {
    if (li.isSubtotal || li.isNote || li.isGroupHeader) return sum
    return sum + toNumber(li.quantity) * toNumber(li.unitPrice)
  }, 0)
}

/** Computes the unit price for a PERCENT_OF_ABOVE item, given the lines above it. */
export function computePercentOfAbovePrice(lines: readonly PrecedingLine[], percentRate: number): number {
  const sum = sumPrecedingLineItems(lines)
  const rate = Number.isFinite(percentRate) ? percentRate : 0
  return Math.round(sum * (rate / 100) * 100) / 100
}
