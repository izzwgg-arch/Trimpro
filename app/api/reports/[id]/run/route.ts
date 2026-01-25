import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { validateRequest } from '@/lib/validation'
import { z } from 'zod'

const runReportSchema = z.object({
  format: z.enum(['csv', 'json']).default('json'),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'reports.run')
  if (permError) return permError

  const user = getAuthUser(request)
  const reportId = params.id

  const validation = await validateRequest(request, runReportSchema)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  const { format } = validation.data

  try {
    const report = await prisma.report.findFirst({
      where: {
        id: reportId,
        tenantId: user.tenantId,
      },
    })

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Check access
    if (!report.isPublic && report.createdBy !== user.id && !report.sharedWith.includes(user.id)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Execute report query based on dataset
    let data: any[] = []
    const filters = (report.filters as any) || []
    const where: any = { tenantId: user.tenantId }

    // Apply filters
    filters.forEach((filter: any) => {
      if (filter.field && filter.value) {
        switch (filter.operator) {
          case 'equals':
            where[filter.field] = filter.value
            break
          case 'notEquals':
            where[filter.field] = { not: filter.value }
            break
          case 'contains':
            where[filter.field] = { contains: filter.value, mode: 'insensitive' }
            break
          case 'greaterThan':
            where[filter.field] = { gt: filter.value }
            break
          case 'lessThan':
            where[filter.field] = { lt: filter.value }
            break
        }
      }
    })

    // Execute query based on dataset
    switch (report.dataset) {
      case 'jobs':
        data = await prisma.job.findMany({
          where,
          take: 1000,
          include: {
            client: {
              select: { name: true },
            },
          },
        })
        break
      case 'invoices':
        data = await prisma.invoice.findMany({
          where,
          take: 1000,
          include: {
            client: {
              select: { name: true },
            },
          },
        })
        break
      case 'leads':
        data = await prisma.lead.findMany({
          where,
          take: 1000,
        })
        break
      case 'clients':
        data = await prisma.client.findMany({
          where,
          take: 1000,
        })
        break
      default:
        return NextResponse.json({ error: 'Unsupported dataset' }, { status: 400 })
    }

    // Create report run record
    const reportRun = await prisma.reportRun.create({
      data: {
        reportId: report.id,
        tenantId: user.tenantId,
        runBy: user.id,
        status: 'COMPLETED',
        format,
      },
    })

    if (format === 'csv') {
      // Convert to CSV
      const columns = (report.columns as string[]) || []
      const csvRows = [
        columns.join(','),
        ...data.map((row) =>
          columns
            .map((col) => {
              const value = col.includes('.') 
                ? col.split('.').reduce((obj: any, key) => obj?.[key], row) 
                : row[col]
              return `"${String(value || '').replace(/"/g, '""')}"`
            })
            .join(',')
        ),
      ]

      return new NextResponse(csvRows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="report-${report.name}-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    }

    return NextResponse.json({
      reportRun,
      data,
      total: data.length,
    })
  } catch (error) {
    console.error('Run report error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
