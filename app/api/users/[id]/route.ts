import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/authorization'
import { getDefaultPermissions } from '@/lib/permissions'

const ALLOWED_ROLES = new Set(['ADMIN', 'MANAGER', 'OFFICE', 'FIELD', 'SALES', 'ACCOUNTING'])
const ALLOWED_STATUSES = new Set(['ACTIVE', 'INACTIVE', 'INVITED', 'SUSPENDED'])

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const actor = getAuthUser(request)
  const canEditUsers = actor.role === 'ADMIN' || (await hasPermission(actor.id, actor.tenantId, 'users.edit'))
  if (!canEditUsers) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : undefined
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : undefined
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined
    const phone = typeof body.phone === 'string' ? body.phone.trim() : body.phone === null ? null : undefined
    const role = typeof body.role === 'string' ? body.role.trim().toUpperCase() : undefined
    const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : undefined
    const rawManagerId = typeof body.managerId === 'string' ? body.managerId.trim() : body.managerId
    const managerIdFromBody = rawManagerId === '' || rawManagerId === null ? null : rawManagerId

    if (!firstName || !lastName || !email || !role || !status) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        id: params.id,
        tenantId: actor.tenantId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        managerId: true,
      },
    })

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const duplicate = await prisma.user.findFirst({
      where: {
        tenantId: actor.tenantId,
        email,
        id: { not: params.id },
      },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
    }

    let normalizedManagerId: string | null = existingUser.managerId || null
    if (role === 'FIELD') {
      if (managerIdFromBody === null) {
        normalizedManagerId = null
      } else if (managerIdFromBody !== undefined) {
        if (typeof managerIdFromBody !== 'string' || !managerIdFromBody) {
          return NextResponse.json({ error: 'Invalid manager selection' }, { status: 400 })
        }
        if (managerIdFromBody === params.id) {
          return NextResponse.json({ error: 'A user cannot be their own manager' }, { status: 400 })
        }

        const managerUser = await prisma.user.findFirst({
          where: {
            id: managerIdFromBody,
            tenantId: actor.tenantId,
            role: 'MANAGER',
          },
          select: { id: true },
        })
        if (!managerUser) {
          return NextResponse.json({ error: 'Selected manager is invalid' }, { status: 400 })
        }
        normalizedManagerId = managerUser.id
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: {
        firstName,
        lastName,
        email,
        phone: phone || null,
        role: role as any,
        status: status as any,
        managerId: role === 'FIELD' ? normalizedManagerId : null,
        ...(role !== existingUser.role ? { permissions: getDefaultPermissions(role as any) } : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        managerId: true,
      },
    })

    // Keep assignments consistent if this user is no longer a manager.
    if (existingUser.role === 'MANAGER' && role !== 'MANAGER') {
      await prisma.user.updateMany({
        where: {
          tenantId: actor.tenantId,
          managerId: params.id,
        },
        data: {
          managerId: null,
        },
      })
    }

    await prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        userId: actor.id,
        action: 'UPDATE',
        entityType: 'User',
        entityId: updatedUser.id,
        changes: {
          before: existingUser,
          after: updatedUser,
        },
      },
    })

    return NextResponse.json({ user: updatedUser })
  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
