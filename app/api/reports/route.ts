import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'reports.view')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const reports = await prisma.report.findMany({
      where: {
        tenantId: user.tenantId,
        OR: [
          { isPublic: true },
          { createdBy: user.id },
          { sharedWith: { has: user.id } },
        ],
      },
      orderBy: {
        updatedAt: 'desc',
      },
    })

    return NextResponse.json({ reports })
  } catch (error) {
    console.error('Get reports error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'reports.create')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const { name, description, type, dataset, columns, filters, groupBy, aggregates, sorting } = body

    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required' }, { status: 400 })
    }

    const report = await prisma.report.create({
      data: {
        tenantId: user.tenantId,
        name,
        description,
        type,
        dataset,
        columns: columns || null,
        filters: filters || null,
        groupBy: groupBy || null,
        aggregates: aggregates || null,
        sorting: sorting || null,
        createdBy: user.id,
        isPublic: false,
        sharedWith: [],
      },
    })

    return NextResponse.json({ report }, { status: 201 })
  } catch (error) {
    console.error('Create report error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
