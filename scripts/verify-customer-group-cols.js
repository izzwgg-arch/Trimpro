require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

;(async () => {
  const prisma = new PrismaClient()
  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'document_line_groups'
      AND lower(column_name) IN ('customerdescription', 'customertotal', 'customeredited')
    ORDER BY column_name
  `)
  console.log(JSON.stringify(rows, null, 2))
  if (!Array.isArray(rows) || rows.length !== 3) {
    console.error('Expected 3 columns, got', Array.isArray(rows) ? rows.length : rows)
    process.exit(1)
  }
  const names = rows.map((r) => r.column_name)
  const expected = ['customerDescription', 'customerEdited', 'customerTotal']
  for (const name of expected) {
    if (!names.includes(name)) {
      console.error('Missing exact camelCase column:', name, 'have:', names)
      process.exit(1)
    }
  }
  console.log('OK: customer columns present with correct camelCase names')
  await prisma.$disconnect()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
