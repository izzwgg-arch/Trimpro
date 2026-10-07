import { PrismaClient } from '@prisma/client'
import { getQboSessionForTenant } from '@/lib/qbo/session'
import { quickBooksService } from '@/lib/services/quickbooks'

const prisma = new PrismaClient()
const CLIENT_ID = process.argv[2] || 'cmnfjys3v04somc0efcz9pfsc'
const NAME = process.argv[3] || '51 Hodson point'

function esc(s: string) {
  return String(s || '').replace(/'/g, "\\'")
}

async function runQuery(accessToken: string, realmId: string, q: string) {
  const res = await quickBooksService.makeAPIRequest(
    accessToken,
    realmId,
    `/query?query=${encodeURIComponent(q)}`,
    'GET'
  )
  const customers = res?.QueryResponse?.Customer || []
  const list = Array.isArray(customers) ? customers : customers ? [customers] : []
  return list.map((c: any) => ({
    Id: c.Id,
    DisplayName: c.DisplayName,
    FullyQualifiedName: c.FullyQualifiedName,
    Active: c.Active,
    Job: c.Job,
    ParentRef: c.ParentRef || null,
  }))
}

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: CLIENT_ID },
    select: { id: true, name: true, companyName: true, tenantId: true, parentId: true },
  })
  if (!client) throw new Error('client not found')
  console.log('CLIENT', client)

  const session = await getQboSessionForTenant(client.tenantId)
  if (!session) throw new Error('no qbo session')

  const queries = [
    `select * from Customer where DisplayName='${esc(NAME)}' maxresults 10`,
    `select * from Customer where Active IN (true, false) AND DisplayName='${esc(NAME)}' maxresults 10`,
    `select * from Customer where DisplayName LIKE '%Hodson%' maxresults 20`,
    `select * from Customer where Id='1039' maxresults 1`,
  ]

  for (const q of queries) {
    try {
      const list = await runQuery(session.accessToken, session.realmId, q)
      console.log('QUERY', q)
      console.log(JSON.stringify(list, null, 2))
    } catch (e: any) {
      console.log('QUERY_FAIL', q, e?.message || e)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
