const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const raw = process.argv[2] || '000421'
const candidates = [raw, `INV-${raw}`, `INV-${raw.replace(/^INV-/i, '')}`, raw.replace(/^INV-/i, '')]

async function main() {
  const invoice = await prisma.invoice.findFirst({
    where: {
      OR: [
        ...candidates.map((invoiceNumber) => ({ invoiceNumber })),
        { id: raw },
      ],
    },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      total: true,
      balance: true,
      paidAmount: true,
      qboSyncId: true,
      qboSyncAt: true,
      paidAt: true,
      updatedAt: true,
      client: { select: { id: true, name: true } },
      payments: {
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          processedAt: true,
          createdAt: true,
          reference: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!invoice) {
    console.log('NOT_FOUND', candidates)
    return
  }

  const total = Number(invoice.total || 0)
  const balance = Number(invoice.balance || 0)
  const paidAmount = Number(invoice.paidAmount || 0)
  const isPaid =
    String(invoice.status || '').toUpperCase() === 'PAID' ||
    (total > 0 && balance <= 0.009) ||
    (total > 0 && paidAmount >= total - 0.009)

  console.log(
    JSON.stringify(
      {
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        client: invoice.client?.name,
        total,
        balance,
        paidAmount,
        paidAt: invoice.paidAt,
        qboSyncId: invoice.qboSyncId,
        isPaid,
        payments: invoice.payments,
      },
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
