import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'roles.view')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const role = await prisma.role.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    })

    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 })
    }

    return NextResponse.json({ role })
  } catch (error) {
    console.error('Get role error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'roles.edit')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const role = await prisma.role.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 })
    }

    if (role.isSystem) {
      return NextResponse.json({ error: 'Cannot edit system roles' }, { status: 403 })
    }

    const body = await request.json()
    const { name, description, permissions } = body

    // Update role
    const updatedRole = await prisma.role.update({
      where: { id: params.id },
      data: {
        name: name || role.name,
        description: description !== undefined ? description : role.description,
      },
    })

    // Update permissions
    if (permissions && Array.isArray(permissions)) {
      // Delete existing permissions
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id },
      })

      // Add new permissions
      const permissionRecords = await prisma.permission.findMany({
        where: {
          key: {
            in: permissions,
          },
        },
      })

      for (const permission of permissionRecords) {
        await prisma.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId: permission.id,
          },
        })
      }
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'UPDATE',
        entityType: 'Role',
        entityId: role.id,
        changes: {
          before: {
            name: role.name,
            description: role.description,
          },
          after: {
            name: updatedRole.name,
            description: updatedRole.description,
            permissions,
          },
        },
      },
    })

    return NextResponse.json({ role: updatedRole })
  } catch (error) {
    console.error('Update role error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const permError = await requirePermission(request, 'roles.delete')
  if (permError) return permError

  const user = getAuthUser(request)

  try {
    const role = await prisma.role.findFirst({
      where: {
        id: params.id,
        tenantId: user.tenantId,
      },
    })

    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 })
    }

    if (role.isSystem) {
      return NextResponse.json({ error: 'Cannot delete system roles' }, { status: 403 })
    }

    await prisma.role.delete({
      where: { id: params.id },
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'DELETE',
        entityType: 'Role',
        entityId: params.id,
        changes: {
          name: role.name,
        },
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete role error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
