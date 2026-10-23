import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { parseTakeoffInput } from '@/lib/takeoffs/model'
import {
  loadJobForTakeoff,
  loadTakeoffConfig,
  requireTakeoffPermission,
  serializeTakeoff,
  takeoffInclude,
} from '@/lib/takeoffs/server'

// GET — the job's material takeoffs (summary list).
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireTakeoffPermission(request, 'view')
  if (permError) return permError

  const user = getAuthUser(request)
  const { job, error } = await loadJobForTakeoff(user, params.id)
  if (error) return error

  try {
    const rows = await prisma.materialTakeoff.findMany({
      where: { tenantId: user.tenantId, jobId: job.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        createdById: true,
        _count: { select: { doors: true, items: true } },
      },
    })
    const creators = await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.createdById).filter(Boolean) as string[] } },
      select: { id: true, firstName: true, lastName: true },
    })
    const nameOf = new Map(creators.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]))
    return NextResponse.json({
      takeoffs: rows.map((r) => ({
        id: r.id,
        title: r.title || '',
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        createdBy: r.createdById ? nameOf.get(r.createdById) || '' : '',
        doorCount: r._count.doors,
        itemCount: r._count.items,
      })),
    })
  } catch (err) {
    console.error('List takeoffs error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — start a takeoff for this job (optionally with its first doors/materials).
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireTakeoffPermission(request, 'create')
  if (permError) return permError

  const user = getAuthUser(request)
  const { job, error } = await loadJobForTakeoff(user, params.id)
  if (error) return error

  try {
    const body = await request.json().catch(() => ({}))
    const config = await loadTakeoffConfig(user.tenantId)
    const parsed = parseTakeoffInput(body, config.categories)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const input = parsed.value

    const created = await prisma.materialTakeoff.create({
      data: {
        tenantId: user.tenantId,
        jobId: job.id,
        title: input.title || null,
        notes: input.notes || null,
        createdById: user.id,
        updatedById: user.id,
        doors: {
          create: input.doors.map((d, i) => ({ ...d, sortOrder: i, doorNumber: i + 1 })),
        },
        items: {
          create: input.items.map((it, i) => ({ ...it, sortOrder: i })),
        },
      },
      include: takeoffInclude,
    })
    return NextResponse.json({ takeoff: await serializeTakeoff(created) }, { status: 201 })
  } catch (err) {
    console.error('Create takeoff error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
