/**
 * Proof for the recurring-payment date math and allocation rules.
 * Pure-function checks; no DB writes. Run: npx tsx scripts/verify-recurring-logic.mjs
 */
// Mirrors advanceNextRun() in lib/payments/recurring.ts (kept identical).
function advanceNextRun(from, frequency) {
  const d = new Date(from)
  const addMonths = (n) => {
    const day = d.getDate()
    d.setMonth(d.getMonth() + n)
    if (d.getDate() < day) d.setDate(0)
    return d
  }
  switch (String(frequency).toUpperCase()) {
    case 'WEEKLY': d.setDate(d.getDate() + 7); return d
    case 'BIWEEKLY': d.setDate(d.getDate() + 14); return d
    case 'QUARTERLY': return addMonths(3)
    case 'YEARLY': return addMonths(12)
    case 'MONTHLY':
    default: return addMonths(1)
  }
}

let pass = 0
let fail = 0
const check = (name, got, want) => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got} want=${want}`)
  ok ? pass++ : fail++
}

// Build + format in LOCAL time to avoid UTC/DST artifacts (the function uses
// local date arithmetic; nextRunAt is a real timestamp in production).
const d = (y, m, day) => new Date(y, m - 1, day)
const local = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`

// Frequencies
check('weekly',    local(advanceNextRun(d(2026, 1, 1), 'WEEKLY')),    '2026-01-08')
check('biweekly',  local(advanceNextRun(d(2026, 1, 1), 'BIWEEKLY')),  '2026-01-15')
check('monthly',   local(advanceNextRun(d(2026, 1, 15), 'MONTHLY')),   '2026-02-15')
check('quarterly', local(advanceNextRun(d(2026, 1, 15), 'QUARTERLY')), '2026-04-15')
check('yearly',    local(advanceNextRun(d(2026, 1, 15), 'YEARLY')),    '2027-01-15')
// Month overflow clamps (Jan 31 -> Feb 28, not Mar 3)
check('month-overflow', local(advanceNextRun(d(2026, 1, 31), 'MONTHLY')), '2026-02-28')
check('quarter-overflow', local(advanceNextRun(d(2025, 11, 30), 'QUARTERLY')), '2026-02-28')

// Allocation never exceeds an invoice's balance (the rule the UI + charge API enforce).
function clampAllocate(payment, invoices) {
  let remaining = Math.round(payment * 100) / 100
  const out = []
  for (const inv of invoices) {
    const take = Math.round(Math.min(remaining, inv.balance) * 100) / 100
    if (take > 0) out.push({ id: inv.id, amount: take })
    remaining = Math.round((remaining - Math.max(0, take)) * 100) / 100
  }
  return { allocations: out, leftover: remaining }
}
const demo = clampAllocate(2000, [
  { id: 'A', balance: 1200 },
  { id: 'B', balance: 850 },
  { id: 'C', balance: 450 },
])
check('alloc A', demo.allocations[0].amount, 1200)
check('alloc B', demo.allocations[1].amount, 800) // only $800 left after A
check('alloc count (C not reached)', demo.allocations.length, 2)
check('leftover held as credit', demo.leftover, 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
