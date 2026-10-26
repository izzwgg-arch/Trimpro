/**
 * Schedule work (Start / Pause / Resume / Finish): allowed moves and active time.
 * Pure functions — no Prisma, no network.
 * Run with:  npx tsx --test tests/schedule-work.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { planWorkAction, summarizeWork } from '../lib/schedules/work'

const base = { workStartedAt: null, workFinishedAt: null, completionNotes: null }

test('allowed moves between work statuses', () => {
  assert.equal(planWorkAction('NOT_STARTED', 'start').kind, 'open')
  assert.equal(planWorkAction('IN_PROGRESS', 'pause').kind, 'close')
  assert.equal(planWorkAction('PAUSED', 'resume').kind, 'open')
  assert.equal(planWorkAction('IN_PROGRESS', 'finish').kind, 'finish')
  assert.equal(planWorkAction('PAUSED', 'finish').kind, 'finish')
})

test('repeating an action (a retried request) changes nothing', () => {
  assert.equal(planWorkAction('IN_PROGRESS', 'start').kind, 'noop')
  assert.equal(planWorkAction('IN_PROGRESS', 'resume').kind, 'noop')
  assert.equal(planWorkAction('PAUSED', 'pause').kind, 'noop')
  assert.equal(planWorkAction('COMPLETED', 'finish').kind, 'noop')
})

test('moves that make no sense are refused, and finished work is locked', () => {
  assert.equal(planWorkAction('NOT_STARTED', 'pause').kind, 'error')
  assert.equal(planWorkAction('NOT_STARTED', 'finish').kind, 'error')
  assert.equal(planWorkAction('NOT_STARTED', 'resume').kind, 'error')
  for (const a of ['start', 'pause', 'resume'] as const) assert.equal(planWorkAction('COMPLETED', a).kind, 'error')
})

test('active time adds up the work periods and leaves out the pauses', () => {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 26, 8, min))
  // Worked 8:00–8:30, paused, worked 9:00–9:15 → 45 minutes; the 30-minute pause is not counted.
  const done = summarizeWork({ ...base, workStatus: 'COMPLETED' }, [
    { startedAt: t(0), endedAt: t(30), status: 'STOPPED' },
    { startedAt: t(60), endedAt: t(75), status: 'STOPPED' },
  ], t(120))
  assert.equal(done.activeSeconds, 45 * 60)
  assert.equal(done.runningSince, null)
  assert.equal(done.segments.length, 2)
})

test('a running period counts up to now and is reported as runningSince', () => {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 26, 8, min))
  const running = summarizeWork({ ...base, workStatus: 'IN_PROGRESS' }, [
    { startedAt: t(0), endedAt: t(10), status: 'STOPPED' },
    { startedAt: t(20), endedAt: null, status: 'ACTIVE' },
  ], t(25))
  assert.equal(running.activeSeconds, 15 * 60)
  assert.equal(running.runningSince, t(20).toISOString())
})
