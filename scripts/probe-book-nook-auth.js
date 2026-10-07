require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')
const fs = require('fs')
const p = new PrismaClient()

function secretFromEnv() {
  const env = fs.readFileSync('.env', 'utf8')
  const m = env.match(/^JWT_SECRET=(.*)$/m) || env.match(/^NEXTAUTH_SECRET=(.*)$/m)
  return m && m[1] ? m[1].trim().replace(/^["']|["']$/g, '') : null
}

;(async () => {
  const secret = secretFromEnv()
  const user = await p.user.findFirst({
    where: { email: 'shia@trimprony.com' },
    select: { id: true, tenantId: true, email: true, role: true },
  })
  console.log('user', user)

  // Try several JWT payload shapes used historically
  const payloads = [
    { userId: user.id, tenantId: user.tenantId, email: user.email, role: user.role },
    { sub: user.id, userId: user.id, tenantId: user.tenantId, email: user.email, role: user.role },
    { id: user.id, userId: user.id, tenantId: user.tenantId, email: user.email, role: user.role },
  ]

  for (const payload of payloads) {
    const token = jwt.sign(payload, secret, { expiresIn: '10m' })
    const r = await fetch('http://127.0.0.1:3000/api/auth/permissions', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const t = await r.text()
    console.log('payload keys', Object.keys(payload), 'status', r.status, t.slice(0, 120))
    if (r.ok) {
      const docs = await fetch('http://127.0.0.1:3000/api/clients/cmnfjysn904vcmc0ed03foq2z/documents', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const dj = await docs.json()
      console.log('docs', docs.status, (dj.documents || []).length, dj.error)

      const client = await fetch('http://127.0.0.1:3000/api/clients/cmnfjysn904vcmc0ed03foq2z', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const cj = await client.json()
      console.log('client', client.status, (cj.client || cj).name, cj.error)
      break
    }
  }

  const matches = await p.client.findMany({
    where: {
      OR: [
        { name: { contains: 'book', mode: 'insensitive' } },
        { companyName: { contains: 'book', mode: 'insensitive' } },
        { email: { contains: 'booknook', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      companyName: true,
      parentClientId: true,
      status: true,
      _count: { select: { jobs: true, invoices: true, estimates: true } },
    },
    take: 20,
  })
  console.log('book matches', matches)

  await p.$disconnect()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
