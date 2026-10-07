require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

;(async () => {
  const prisma = new PrismaClient()
  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'purchase_orders'
      AND lower(column_name) IN ('internalnotes', 'deliveryaddress')
    ORDER BY column_name
  `)
  console.log(JSON.stringify(rows, null, 2))
  await prisma.$disconnect()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
