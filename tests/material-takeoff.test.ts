/**
 * Material takeoff: dropdown defaults, saved-input validation, and PO line building.
 * Pure functions — no Prisma, no network.
 * Run with:  npx tsx --test tests/material-takeoff.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activeValues,
  buildDefaultTakeoffConfig,
  DEFAULT_CATEGORIES,
  mergeTakeoffConfig,
} from '../lib/takeoffs/config'
import { buildPurchaseOrderLines, MAX_DOORS, parseQuantity, parseTakeoffInput } from '../lib/takeoffs/model'

const config = buildDefaultTakeoffConfig()
const cats = config.categories

test('default dropdowns match the takeoff sheet exactly', () => {
  assert.deepEqual(activeValues(config.doorFields.height), [`8'0"`, `6'8"`])
  assert.deepEqual(activeValues(config.doorFields.width), [`3/0"`, `2/8"`, `2/6"`, `2/4"`, `2/0"`, '50', '28', '60', '38', '34'])
  assert.deepEqual(activeValues(config.doorFields.swing), ['RH', 'LH', 'Twin', 'Pocket'])
  assert.deepEqual(activeValues(config.doorFields.lock), ['Entry', 'Privacy', 'Passage', 'Dummy X2', 'Privacy-Dummy'])
  assert.deepEqual(activeValues(config.doorFields.jamb), [`5 5/8"`, `6 7/8"`, `6 3/8"`, `4-7/8"`])
  // No company list exists yet for these — they start empty (typed or added in Settings).
  assert.deepEqual(config.doorFields.hinge, [])
  assert.deepEqual(config.doorFields.doorStyle, [])
})

test('default material categories follow the sheet', () => {
  assert.deepEqual(
    cats.map((c) => c.label),
    ['Base', 'Casing', 'Attic Stair', 'Windows', 'High Windows', 'Big Windows', 'Convectors', 'Patio Door', 'Trim Entry', 'Trim Opening', 'Closets']
  )
  assert.ok(cats.every((c) => c.active))
})

test('settings: turned-off options are kept but not offered; removed options stay removed', () => {
  const merged = mergeTakeoffConfig({
    doorFields: { swing: [{ value: 'RH', active: true }, { value: 'LH', active: false }, { value: 'Barn', active: true }] },
  })
  assert.deepEqual(activeValues(merged.doorFields.swing), ['RH', 'Barn'])
  assert.equal(merged.doorFields.swing.length, 3)
  // Fields not in the stored config keep their defaults.
  assert.deepEqual(activeValues(merged.doorFields.height), [`8'0"`, `6'8"`])
})

test('settings: categories can be turned off and new defaults still appear', () => {
  const merged = mergeTakeoffConfig({
    categories: [
      { key: 'closets', label: 'Closets', active: false, options: ['Wire shelf'] },
      { key: 'crown', label: 'Crown', active: true, options: [] },
    ],
  })
  assert.equal(merged.categories[0].key, 'closets')
  assert.equal(merged.categories[0].active, false)
  assert.deepEqual(activeValues(merged.categories[0].options), ['Wire shelf'])
  assert.equal(merged.categories[1].label, 'Crown')
  // Every default category is still there (as available) even if missing from storage.
  for (const d of DEFAULT_CATEGORIES) assert.ok(merged.categories.some((c) => c.key === d.key), d.key)
})

test('saved values keep their exact text (fractions, quotes, hyphens)', () => {
  const r = parseTakeoffInput(
    {
      doors: [{ height: ` 6'8" `, width: '2/9" custom', jamb: '4-7/8"', swing: 'Barn slider', hinge: '3.5" satin', doorStyle: 'Shaker 2-panel' }],
      items: [{ category: 'base', quantity: '1 1/2', unit: 'LF', description: '5 1/4" colonial' }],
    },
    cats
  )
  assert.equal(r.ok, true)
  if (!r.ok) return
  const d = r.value.doors[0]
  assert.equal(d.height, `6'8"`)
  assert.equal(d.width, '2/9" custom')
  assert.equal(d.jamb, '4-7/8"')
  assert.equal(d.swing, 'Barn slider')
  assert.equal(r.value.items[0].quantity, 1.5)
  assert.equal(r.value.items[0].description, '5 1/4" colonial')
})

test('row order is kept and 40+ doors are accepted', () => {
  const doors = Array.from({ length: 45 }, (_, i) => ({ location: `Room ${i + 1}` }))
  const r = parseTakeoffInput({ doors }, cats)
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.value.doors.map((d) => d.location), doors.map((d) => d.location))
  const tooMany = parseTakeoffInput({ doors: Array.from({ length: MAX_DOORS + 1 }, () => ({})) }, cats)
  assert.equal(tooMany.ok, false)
})

test('quantities: numbers, decimals and fractions; anything else is rejected', () => {
  assert.equal(parseQuantity('12'), 12)
  assert.equal(parseQuantity('12.5'), 12.5)
  assert.equal(parseQuantity('3/4'), 0.75)
  assert.equal(parseQuantity('1 1/2'), 1.5)
  assert.equal(parseQuantity('1,200'), 1200)
  assert.equal(parseQuantity(''), null)
  assert.equal(parseQuantity('abc'), null)
  const r = parseTakeoffInput({ items: [{ category: 'base', quantity: 'abc' }] }, cats)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /Base/)
  const empty = parseTakeoffInput({ items: [{ category: 'base', quantity: '' }] }, cats)
  assert.equal(empty.ok, true)
  if (empty.ok) assert.equal(empty.value.items[0].quantity, null)
})

test('purchase order lines: identical doors grouped, locks counted, materials listed', () => {
  const doors = [
    { doorNumber: 1, width: '2/8"', height: `6'8"`, swing: 'LH', jamb: '4-7/8"', lock: 'Privacy', hinge: '', doorStyle: '', location: '', notes: '' },
    { doorNumber: 2, width: '2/8"', height: `6'8"`, swing: 'LH', jamb: '4-7/8"', lock: 'Passage', hinge: '', doorStyle: '', location: '', notes: '' },
    { doorNumber: 3, width: '3/0"', height: `8'0"`, swing: 'RH', jamb: '6 7/8"', lock: 'Privacy', hinge: '', doorStyle: '', location: '', notes: '' },
    { doorNumber: 4, width: '', height: '', swing: '', jamb: '', lock: '', hinge: '', doorStyle: '', location: '', notes: '' }, // empty row ignored
  ]
  const items = [
    { category: 'base', quantity: 120, unit: 'LF', description: '5 1/4" colonial', notes: null },
    { category: 'closets', quantity: null, unit: null, description: null, notes: null }, // empty ignored
  ]
  const lines = buildPurchaseOrderLines({ doors, items }, config)
  const doorLines = lines.filter((l) => l.description.startsWith('Door'))
  assert.equal(doorLines.length, 2)
  assert.equal(doorLines[0].description, `Door 2/8" x 6'8"`)
  assert.equal(doorLines[0].quantity, '2')
  assert.equal(doorLines[0].notes, 'Door #1, #2')
  const privacy = lines.find((l) => l.description === 'Lock: Privacy')
  assert.equal(privacy?.quantity, '2')
  const base = lines.find((l) => l.description.startsWith('Base'))
  assert.equal(base?.description, 'Base: 5 1/4" colonial')
  assert.equal(base?.quantity, '120')
  assert.equal(base?.details, 'Unit: LF')
  assert.equal(lines.some((l) => l.description === 'Closets'), false)
})
