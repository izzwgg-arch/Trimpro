/**
 * Centralized Authorization Layer
 * Provides permission checking and enforcement
 */

import { prisma } from './prisma'
import { User } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

export interface UserWithRoles extends User {
  userRoles?: Array<{
    role: {
      id: string
      name: string
      permissions: Array<{
        permission: {
          key: string
        }
      }>
    }
  }>
}

/**
 * Get all permissions for a user (from all their roles)
 */
export async function getUserPermissions(
  userId: string,
  tenantId: string
): Promise<string[]> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    include: {
      userRoles: {
        where: {
          role: {
            isActive: true,
          },
        },
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!user) {
    return []
  }

  const permissions = new Set<string>()

  // Collect permissions from all active roles
  for (const userRole of user.userRoles || []) {
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(rolePermission.permission.key)
    }
  }

  return Array.from(permissions)
}

/**
 * Check if user has a specific permission
 */
export async function hasPermission(
  userId: string,
  tenantId: string,
  permission: string
): Promise<boolean> {
  const userPermissions = await getUserPermissions(userId, tenantId)
  return userPermissions.includes(permission)
}

/**
 * Check if user has any of the specified permissions
 */
export async function hasAnyPermission(
  userId: string,
  tenantId: string,
  permissions: string[]
): Promise<boolean> {
  const userPermissions = await getUserPermissions(userId, tenantId)
  return permissions.some((perm) => userPermissions.includes(perm))
}

/**
 * Check if user has all of the specified permissions
 */
export async function hasAllPermissions(
  userId: string,
  tenantId: string,
  permissions: string[]
): Promise<boolean> {
  const userPermissions = await getUserPermissions(userId, tenantId)
  return permissions.every((perm) => userPermissions.includes(perm))
}

/**
 * Require permission middleware for API routes
 * Returns error response if user doesn't have permission
 */
export async function requirePermission(
  request: NextRequest,
  permission: string
): Promise<NextResponse | null> {
  const user = (request as any).user
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hasPerm = await hasPermission(user.id, user.tenantId, permission)
  if (!hasPerm) {
    return NextResponse.json(
      { error: 'Forbidden: Insufficient permissions' },
      { status: 403 }
    )
  }

  return null // Permission granted
}

/**
 * Require any of the specified permissions
 */
export async function requireAnyPermission(
  request: NextRequest,
  permissions: string[]
): Promise<NextResponse | null> {
  const user = (request as any).user
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hasPerm = await hasAnyPermission(user.id, user.tenantId, permissions)
  if (!hasPerm) {
    return NextResponse.json(
      { error: 'Forbidden: Insufficient permissions' },
      { status: 403 }
    )
  }

  return null
}

/**
 * Check if user can access a specific resource
 * This is for attribute-based access control (constraints)
 */
export async function canAccessResource(
  userId: string,
  tenantId: string,
  resourceType: string,
  resourceId: string,
  action: string
): Promise<boolean> {
  // First check if user has the base permission
  const permission = `${resourceType}.${action}`
  const hasBasePermission = await hasPermission(userId, tenantId, permission)

  if (!hasBasePermission) {
    return false
  }

  // Check for constraints
  const constraints = await prisma.permissionConstraint.findMany({
    where: {
      OR: [
        { userId },
        {
          role: {
            userRoles: {
              some: {
                userId,
              },
            },
          },
        },
      ],
      permission: {
        key: permission,
      },
    },
    include: {
      permission: true,
    },
  })

  // If no constraints, base permission is sufficient
  if (constraints.length === 0) {
    return true
  }

  // Apply constraints
  for (const constraint of constraints) {
    switch (constraint.constraintType) {
      case 'own_records_only':
        // Check if user owns the resource
        const resource = await prisma.$queryRawUnsafe(
          `SELECT "userId" FROM ${resourceType} WHERE id = $1 AND "tenantId" = $2`,
          resourceId,
          tenantId
        )
        if (Array.isArray(resource) && resource[0]?.userId !== userId) {
          return false
        }
        break

      case 'team_only':
        // Check if resource is assigned to user's team
        // This would require team relationships to be implemented
        // For now, return true if base permission exists
        break

      case 'assigned_jobs_only':
        if (resourceType === 'jobs') {
          const assignment = await prisma.jobAssignment.findFirst({
            where: {
              jobId: resourceId,
              userId,
            },
          })
          if (!assignment) {
            return false
          }
        }
        break

      // Add more constraint types as needed
    }
  }

  return true
}

/**
 * Get user's effective permissions (for display in UI)
 */
export async function getEffectivePermissions(
  userId: string,
  tenantId: string
): Promise<{
  permissions: string[]
  roles: Array<{ id: string; name: string; isSystem: boolean }>
}> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!user) {
    return { permissions: [], roles: [] }
  }

  const permissions = new Set<string>()
  const roles = []

  for (const userRole of user.userRoles || []) {
    roles.push({
      id: userRole.role.id,
      name: userRole.role.name,
      isSystem: userRole.role.isSystem,
    })

    for (const rolePermission of userRole.role.permissions) {
      permissions.add(rolePermission.permission.key)
    }
  }

  return {
    permissions: Array.from(permissions),
    roles,
  }
}
