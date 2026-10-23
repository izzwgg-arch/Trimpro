import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { parseTakeoffInput } from '@/lib/takeoffs/model'
import {
  loadTakeoff,
  loadTakeoffConfig,
  requireTakeoffPermission,
  serializeTakeoff,
  takeoffInclude,
} from '@/lib/takeoffs/server'

// GET — one takeoff with its door schedule and materials.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireTakeoffPermission(request, 'view')
  if (permError) return permError

  const user = getAuthUser(request)
  const { takeoff, error } = await loadTakeoff(user, params.id)
  if (error) return error
  return NextResponse.json({ takeoff: await serializeTakeoff(takeoff) })
}

/**
 * PUT — save the whole takeoff (header, doors, materials) at once. Rows are replaced
 * inside one transaction so a save is never half-applied. Send `expectedUpdatedAt`
 * (the updatedAt you loaded) to get a 409 instead of overwriting someone else's save.
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireTakeoffPermission(request, 'edit')
  if (permError) return permError

  const user = getAuthUser(request)
  const { takeoff, error } = await loadTakeoff(user, params.id)
  if (error) return error

  try {
    const body = await request.json()
    if (body?.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== takeoff.updatedAt.getTime()) {
      return NextResponse.json(
        { error: 'This takeoff was changed by someone else since you opened it. Reload to see the latest version.' },
        { status: 409 }
      )
    }
    const config = await loadTakeoffConfig(user.tenantId)
    const parsed = parseTakeoffInput(body, config.categories)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const input = parsed.value

    const saved = await prisma.$transaction(async (tx) => {
      await tx.materialTakeoffDoor.deleteMany({ where: { takeoffId: takeoff.id } })
      await tx.materialTakeoffItem.deleteMany({ where: { takeoffId: takeoff.id } })
      if (input.doors.length) {
        await tx.materialTakeoffDoor.createMany({
          data: input.doors.map((d, i) => ({ ...d, takeoffId: takeoff.id, sortOrder: i, doorNumber: i + 1 })),
        })
      }
      if (input.items.length) {
        await tx.materialTakeoffItem.createMany({
          data: input.items.map((it, i) => ({ ...it, takeoffId: takeoff.id, sortOrder: i })),
        })
      }
      return tx.materialTakeoff.update({
        where: { id: takeoff.id },
        data: { title: input.title || null, notes: input.notes || null, updatedById: user.id },
        include: takeoffInclude,
      })
    })
    return NextResponse.json({ takeoff: await serializeTakeoff(saved) })
  } catch (err) {
    console.error('Save takeoff error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE — remove the takeoff and its rows.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireTakeoffPermission(request, 'delete')
  if (permError) return permError

  const user = getAuthUser(request)
  const { takeoff, error } = await loadTakeoff(user, params.id)
  if (error) return error

  try {
    await prisma.materialTakeoff.delete({ where: { id: takeoff.id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Delete takeoff error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
