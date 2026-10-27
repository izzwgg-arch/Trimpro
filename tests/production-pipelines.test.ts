/**
 * Estimate / Invoice pipelines: stages come from the real status and money,
 * stored flags never contradict them, and settings merge safely.
 * Pure functions — no Prisma, no network.
 * Run with:  npx tsx --test tests/production-pipelines.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allowedManualChanges,
  buildDefaultPipelineConfig,
  daysSince,
  deriveEstimateStage,
  deriveInvoiceStage,
  isFollowUpOverdue,
  isInvoiceOverdue,
  mergePipelineConfig,
} from '../lib/production/pipelines'

const NOW = new Date('2026-10-27T15:00:00')
const est = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  createdAt: '2026-10-01T10:00:00',
  updatedAt: '2026-10-20T10:00:00',
  ...extra,
})
const inv = (status: string, total: number, paid: number, extra: Record<string, unknown> = {}) => ({
  status,
  total,
  paidAmount: paid,
  balance: total - paid,
  createdAt: '2026-10-01T10:00:00',
  updatedAt: '2026-10-20T10:00:00',
  ...extra,
})

test('estimate stages follow the real status', () => {
  assert.equal(deriveEstimateStage(est('DRAFT')).stage, 'DRAFT')
  assert.equal(deriveEstimateStage(est('SENT', { sentAt: '2026-10-05' })).stage, 'SENT')
  assert.equal(deriveEstimateStage(est('VIEWED')).stage, 'AWAITING_APPROVAL')
  assert.equal(deriveEstimateStage(est('ACCEPTED')).stage, 'APPROVED')
  assert.equal(deriveEstimateStage(est('REJECTED')).stage, 'REJECTED')
  assert.equal(deriveEstimateStage(est('EXPIRED')).stage, 'EXPIRED')
  assert.equal(deriveEstimateStage(est('CONVERTED')).stage, 'CONVERTED')
  assert.equal(deriveEstimateStage(est('CONVERTED')).closed, true)
  // The stage start comes from the record's own dates.
  assert.equal(deriveEstimateStage(est('SENT', { sentAt: '2026-10-05T09:00:00' })).enteredAt?.getDate(), 5)
})

test('estimate review steps only apply while it is a draft', () => {
  const s = { reviewStage: 'READY_TO_SEND', reviewStageAt: '2026-10-10T08:00:00' }
  assert.equal(deriveEstimateStage(est('DRAFT'), s).stage, 'READY_TO_SEND')
  // Once it is actually sent the stored step is ignored (and reported as such).
  const sent = deriveEstimateStage(est('SENT'), s)
  assert.equal(sent.stage, 'SENT')
  assert.equal(sent.ignoredManual, 'READY_TO_SEND')
})

test('a hold shows on open estimates but never hides a closed outcome', () => {
  const held = { onHold: true, heldAt: '2026-10-22T08:00:00' }
  assert.equal(deriveEstimateStage(est('SENT'), held).stage, 'ON_HOLD')
  assert.equal(deriveEstimateStage(est('DRAFT', {}), { ...held, reviewStage: 'INTERNAL_REVIEW' }).stage, 'ON_HOLD')
  assert.equal(deriveEstimateStage(est('REJECTED'), held).stage, 'REJECTED')
  assert.equal(deriveEstimateStage(est('CONVERTED'), held).stage, 'CONVERTED')
})

test('invoice stages come from status and the actual balance', () => {
  assert.equal(deriveInvoiceStage(inv('DRAFT', 100, 0), null, NOW).stage, 'DRAFT')
  assert.equal(deriveInvoiceStage(inv('SENT', 100, 0, { dueDate: '2026-11-30' }), null, NOW).stage, 'SENT')
  assert.equal(deriveInvoiceStage(inv('VIEWED', 100, 0, { dueDate: '2026-11-30' }), null, NOW).stage, 'PAYMENT_OUTSTANDING')
  assert.equal(deriveInvoiceStage(inv('PARTIAL', 100, 40, { dueDate: '2026-11-30' }), null, NOW).stage, 'PARTIALLY_PAID')
  assert.equal(deriveInvoiceStage(inv('PAID', 100, 100), null, NOW).stage, 'PAID')
  assert.equal(deriveInvoiceStage(inv('CANCELLED', 100, 0), null, NOW).stage, 'CANCELLED')
  assert.equal(deriveInvoiceStage(inv('REFUNDED', 100, 100), null, NOW).stage, 'REFUNDED')
  // Balance at zero counts as paid even if the status lags behind.
  assert.equal(deriveInvoiceStage(inv('PARTIAL', 100, 100), null, NOW).stage, 'PAID')
})

test('overdue is automatic once the due date passes with money owed', () => {
  assert.equal(isInvoiceOverdue(inv('SENT', 100, 0, { dueDate: '2026-10-20' }), NOW), true)
  assert.equal(isInvoiceOverdue(inv('SENT', 100, 0, { dueDate: '2026-10-27' }), NOW), false) // due today: not yet
  assert.equal(isInvoiceOverdue(inv('PARTIAL', 100, 100, { dueDate: '2026-10-01' }), NOW), false) // nothing owed
  assert.equal(isInvoiceOverdue(inv('DRAFT', 100, 0, { dueDate: '2026-10-01' }), NOW), false) // never sent
  assert.equal(deriveInvoiceStage(inv('PARTIAL', 100, 40, { dueDate: '2026-10-20' }), null, NOW).stage, 'OVERDUE')
  assert.equal(deriveInvoiceStage(inv('OVERDUE', 100, 0), null, NOW).stage, 'OVERDUE')
})

test('stored invoice flags never contradict accounting', () => {
  const disputed = { disputed: true, disputedAt: '2026-10-21T08:00:00' }
  assert.equal(deriveInvoiceStage(inv('SENT', 100, 0, { dueDate: '2026-10-20' }), disputed, NOW).stage, 'DISPUTED')
  const paid = deriveInvoiceStage(inv('PAID', 100, 100), disputed, NOW)
  assert.equal(paid.stage, 'PAID')
  assert.equal(paid.ignoredManual, 'DISPUTED')
  assert.equal(deriveInvoiceStage(inv('PAID', 100, 100), { onHold: true }, NOW).stage, 'PAID')
  assert.equal(deriveInvoiceStage(inv('SENT', 100, 0), { onHold: true }, NOW).stage, 'ON_HOLD')
  assert.equal(deriveInvoiceStage(inv('SENT', 100, 0), { reviewStage: 'INTERNAL_REVIEW' }, NOW).stage, 'SENT')
  assert.equal(deriveInvoiceStage(inv('DRAFT', 100, 0), { reviewStage: 'INTERNAL_REVIEW' }, NOW).stage, 'INTERNAL_REVIEW')
})

test('what a person may change depends on the real status', () => {
  assert.deepEqual(allowedManualChanges('ESTIMATE', 'DRAFT', false), { hold: true, review: true, dispute: false })
  assert.deepEqual(allowedManualChanges('ESTIMATE', 'REJECTED', true), { hold: false, review: false, dispute: false })
  assert.deepEqual(allowedManualChanges('INVOICE', 'SENT', false), { hold: true, review: false, dispute: true })
  assert.deepEqual(allowedManualChanges('INVOICE', 'PAID', true), { hold: false, review: false, dispute: false })
})

test('follow-ups and days in stage', () => {
  assert.equal(isFollowUpOverdue('2026-10-26T12:00:00', false, NOW), true)
  assert.equal(isFollowUpOverdue('2026-10-27T12:00:00', false, NOW), false)
  assert.equal(isFollowUpOverdue('2026-10-01T12:00:00', true, NOW), false) // finished records never nag
  assert.equal(daysSince(new Date('2026-10-20T23:00:00'), NOW), 7)
  assert.equal(daysSince(null, NOW), null)
})

test('settings merge keeps fixed stage ids and cleans bad values', () => {
  const merged = mergePipelineConfig({
    estimates: { stages: [{ id: 'SENT', label: '  Out to client ', color: 'red', order: -1, visible: false }, { id: 'BOGUS', label: 'x' }] },
    holdReasons: ['  ', 'Permit'],
    holdFollowUpDays: 500,
    allWork: { invoices: false },
  })
  const sent = merged.estimates.stages.find((s) => s.id === 'SENT')!
  assert.equal(sent.label, 'Out to client')
  assert.equal(sent.color, '#3b82f6') // invalid color falls back
  assert.equal(sent.visible, false)
  assert.equal(merged.estimates.stages[0].id, 'SENT') // reordered first
  assert.equal(merged.estimates.stages.some((s) => s.id === 'BOGUS'), false)
  assert.equal(merged.estimates.stages.length, buildDefaultPipelineConfig().estimates.stages.length)
  assert.deepEqual(merged.holdReasons, ['Permit'])
  assert.equal(merged.holdFollowUpDays, 3)
  assert.deepEqual(merged.allWork, { jobs: true, estimates: true, invoices: false })
})
