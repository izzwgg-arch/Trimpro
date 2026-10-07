const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  let tenant = await prisma.tenant.findFirst({ where: { name: 'Default Tenant' } })
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: 'Default Tenant', subdomain: 'default', isActive: true },
    })
  }

  let client = await prisma.client.findFirst({ where: { tenantId: tenant.id } })
  if (!client) {
    client = await prisma.client.create({
      data: {
        tenantId: tenant.id,
        name: '3 Brigadoon Dr',
        email: 'demo@trimpro.local',
        isActive: true,
      },
    })
  }

  let job = await prisma.job.findFirst({
    where: { tenantId: tenant.id, jobNumber: 'JOB-DEV-001' },
  })
  if (!job) {
    job = await prisma.job.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        jobNumber: 'JOB-DEV-001',
        title: 'Shul furniture (dev demo)',
        status: 'QUOTE',
        priority: 3,
      },
    })
  }

  const existingEstimates = await prisma.estimate.count({ where: { jobId: job.id } })
  if (existingEstimates < 2) {
    const nums = ['EST-DEV-001', 'EST-DEV-002']
    for (let i = existingEstimates; i < 2; i++) {
      await prisma.estimate.create({
        data: {
          tenantId: tenant.id,
          clientId: client.id,
          jobId: job.id,
          estimateNumber: nums[i],
          title: i === 0 ? 'Original estimate' : 'Revision estimate',
          status: i === 0 ? 'CONVERTED' : 'DRAFT',
          subtotal: 4800,
          taxRate: 0,
          taxAmount: 0,
          discount: 0,
          total: 4800,
        },
      })
    }
  }

  let paidInvoice = await prisma.invoice.findFirst({
    where: { tenantId: tenant.id, invoiceNumber: 'INV-DEV-001' },
  })
  if (!paidInvoice) {
    paidInvoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        jobId: job.id,
        invoiceNumber: 'INV-DEV-001',
        title: 'Deposit invoice (paid)',
        status: 'PAID',
        subtotal: 2400,
        taxRate: 0,
        taxAmount: 0,
        discount: 0,
        total: 2400,
        paidAmount: 2400,
        balance: 0,
        paidAt: new Date(),
      },
    })

    await prisma.payment.create({
      data: {
        invoiceId: paidInvoice.id,
        amount: 2400,
        status: 'COMPLETED',
        method: 'CHECK',
        reference: `PAY-DEV-${Date.now()}`,
        processedAt: new Date(),
      },
    })
  }

  let openInvoice = await prisma.invoice.findFirst({
    where: { tenantId: tenant.id, invoiceNumber: 'INV-DEV-002' },
  })
  if (!openInvoice) {
    openInvoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        jobId: job.id,
        invoiceNumber: 'INV-DEV-002',
        title: 'Balance due (open)',
        status: 'SENT',
        subtotal: 2400,
        taxRate: 0,
        taxAmount: 0,
        discount: 0,
        total: 2400,
        paidAmount: 0,
        balance: 2400,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    })
  }

  console.log(
    JSON.stringify({
      clientId: client.id,
      clientUrl: `http://localhost:3000/dashboard/clients/${client.id}`,
      jobId: job.id,
      jobNumber: job.jobNumber,
      jobUrl: `http://localhost:3000/dashboard/jobs/${job.id}`,
      documents: {
        estimates: 2,
        invoices: 2,
        payments: 1,
      },
    })
  )
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
