require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')
const fs = require('fs')
const p = new PrismaClient()

;(async () => {
  const env = fs.readFileSync('.env', 'utf8')
  const m = env.match(/^JWT_SECRET=(.*)$/m)
  const secret = (m && m[1] ? m[1].trim().replace(/^["']|["']$/g, '') : null)
  const user = await p.user.findFirst({
    where: { email: 'shia@trimprony.com' },
    select: { id: true, tenantId: true, email: true, role: true },
  })
  const token = jwt.sign(
    { userId: user.id, tenantId: user.tenantId, email: user.email, role: user.role },
    secret,
    { expiresIn: '10m' }
  )
  const headers = { Authorization: `Bearer ${token}` }
  const ids = {
    parent: 'cmnfjysn904vcmc0ed03foq2z',
    child: 'cmnxkf7d500dly5h1gzketzzy',
    job: 'cmq82jbz000cjozifqw5l33lp',
  }

  for (const [label, path] of [
    ['client', `/api/clients/${ids.parent}`],
    ['client-docs', `/api/clients/${ids.parent}/documents`],
    ['child', `/api/clients/${ids.child}`],
    ['child-docs', `/api/clients/${ids.child}/documents`],
    ['job', `/api/jobs/${ids.job}`],
    ['job-docs', `/api/jobs/${ids.job}/documents`],
    ['search', `/api/search?q=${encodeURIComponent('book nook')}`],
  ]) {
    const t0 = Date.now()
    try {
      const r = await fetch(`http://127.0.0.1:3000${path}`, { headers })
      const text = await r.text()
      let extra = ''
      try {
        const j = JSON.parse(text)
        if (j.documents) extra = ` docs=${j.documents.length}`
        if (j.client) extra = ` name=${j.client.name || j.client.companyName}`
        if (j.error) extra = ` error=${j.error}`
        if (j.results) extra = ` results=${Array.isArray(j.results) ? j.results.length : Object.keys(j.results || {}).length}`
      } catch {}
      console.log(`${label}: ${r.status} ${Date.now() - t0}ms ${text.length}b${extra}`)
    } catch (e) {
      console.log(`${label}: FAIL ${Date.now() - t0}ms ${e.message}`)
    }
  }

  // Recent audit / search for book nook
  const recent = await p.$queryRawUnsafe(`
    SELECT id, "createdAt", action, meta::text
    FROM "AuditLog"
    WHERE "createdAt" > NOW() - INTERVAL '2 hours'
      AND (meta::text ILIKE '%book%' OR meta::text ILIKE '%cmnfjysn904vcmc0ed03foq2z%')
    ORDER BY "createdAt" DESC
    LIMIT 20
  `).catch(() => null)
  if (recent) console.log('audit', JSON.stringify(recent, null, 2).slice(0, 2000))

  await p.$disconnect()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
