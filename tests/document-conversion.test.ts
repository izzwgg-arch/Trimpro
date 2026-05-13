import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateEstimateConversionSummary } from '../lib/documents/conversion'

test('estimate conversion percentage sums multiple linked invoice totals', () => {
  const summary = calculateEstimateConversionSummary('1000', ['500', '250'])

  assert.equal(summary.invoicedTotal, 750)
  assert.equal(summary.convertedPercent, 75)
})

test('estimate conversion percentage clamps at 100 for display', () => {
  const summary = calculateEstimateConversionSummary('1000', ['500', '600'])

  assert.equal(summary.invoicedTotal, 1100)
  assert.equal(summary.convertedPercent, 100)
})

