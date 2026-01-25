import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { PERMISSIONS } from '../lib/permissions-catalog'

const prisma = new PrismaClient()

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

async function seedPermissions() {
  console.log('📋 Seeding permissions...')
  
  const permissionCount = await prisma.permission.count()
  if (permissionCount > 0) {
    console.log(`✅ Permissions already exist (${permissionCount} permissions)`)
    return
  }

  for (const perm of PERMISSIONS) {
    await prisma.permission.create({
      data: {
        key: perm.key,
        label: perm.label,
        description: perm.description,
        category: perm.category,
        module: perm.module,
      },
    })
  }

  console.log(`✅ Created ${PERMISSIONS.length} permissions`)
}

async function seedRoles(tenantId: string) {
  console.log('👥 Seeding system roles...')

  // Check if roles already exist for this tenant
  const existingRoles = await prisma.role.findMany({
    where: { tenantId, isSystem: true },
  })

  if (existingRoles.length > 0) {
    console.log(`✅ System roles already exist (${existingRoles.length} roles)`)
    return existingRoles
  }

  // Get all permissions
  const allPermissions = await prisma.permission.findMany()

  // Define system roles with their permissions
  const systemRoles = [
    {
      name: 'Owner',
      description: 'Full system access with all permissions',
      permissions: allPermissions.map((p) => p.key), // All permissions
    },
    {
      name: 'Admin',
      description: 'Administrative access with most permissions',
      permissions: allPermissions
        .filter((p) => !p.key.startsWith('roles.delete') && !p.key.startsWith('system.'))
        .map((p) => p.key),
    },
    {
      name: 'Manager',
      description: 'Management access for operations and team',
      permissions: allPermissions
        .filter(
          (p) =>
            !p.key.startsWith('users.') &&
            !p.key.startsWith('roles.') &&
            !p.key.startsWith('settings.') &&
            !p.key.startsWith('system.')
        )
        .map((p) => p.key),
    },
    {
      name: 'Dispatcher',
      description: 'Dispatch and scheduling access',
      permissions: allPermissions
        .filter(
          (p) =>
            p.key.startsWith('dispatch.') ||
            p.key.startsWith('schedule.') ||
            p.key.startsWith('jobs.view') ||
            p.key.startsWith('jobs.assign') ||
            p.key.startsWith('jobs.reassign') ||
            p.key.startsWith('jobs.change_status') ||
            p.key.startsWith('clients.view') ||
            p.key.startsWith('calls.') ||
            p.key.startsWith('messages.')
        )
        .map((p) => p.key),
    },
    {
      name: 'Tech',
      description: 'Field technician access',
      permissions: allPermissions
        .filter(
          (p) =>
            p.key.startsWith('jobs.view') ||
            p.key.startsWith('jobs.add_notes') ||
            p.key.startsWith('jobs.change_status') ||
            p.key.startsWith('tasks.view') ||
            p.key.startsWith('tasks.complete') ||
            p.key.startsWith('issues.view') ||
            p.key.startsWith('issues.create') ||
            p.key.startsWith('calls.view') ||
            p.key.startsWith('messages.view')
        )
        .map((p) => p.key),
    },
    {
      name: 'Accounting',
      description: 'Financial and accounting access',
      permissions: allPermissions
        .filter(
          (p) =>
            p.key.startsWith('invoices.') ||
            p.key.startsWith('estimates.view') ||
            p.key.startsWith('payments.') ||
            p.key.startsWith('purchase_orders.view') ||
            p.key.startsWith('clients.view') ||
            p.key.startsWith('reports.view') ||
            p.key.startsWith('analytics.view')
        )
        .map((p) => p.key),
    },
    {
      name: 'ReadOnly',
      description: 'Read-only access to all modules',
      permissions: allPermissions
        .filter((p) => p.key.endsWith('.view'))
        .map((p) => p.key),
    },
  ]

  const createdRoles = []

  for (const roleDef of systemRoles) {
    const role = await prisma.role.create({
      data: {
        tenantId,
        name: roleDef.name,
        description: roleDef.description,
        isSystem: true,
        isActive: true,
      },
    })

    // Assign permissions to role
    const permissionsToAssign = allPermissions.filter((p) =>
      roleDef.permissions.includes(p.key)
    )

    for (const permission of permissionsToAssign) {
      await prisma.rolePermission.create({
        data: {
          roleId: role.id,
          permissionId: permission.id,
        },
      })
    }

    createdRoles.push(role)
    console.log(`   ✅ Created role: ${roleDef.name} (${permissionsToAssign.length} permissions)`)
  }

  return createdRoles
}

async function main() {
  console.log('🌱 Starting database seed...')

  // Seed permissions first (global, not tenant-specific)
  await seedPermissions()

  // Check if admin already exists
  const existingAdmin = await prisma.user.findFirst({
    where: {
      email: 'admin@trimpro.com',
      role: 'ADMIN',
    },
  })

  // Create default tenant
  let tenant = await prisma.tenant.findFirst({
    where: {
      name: 'Default Tenant',
    },
  })

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Default Tenant',
        subdomain: 'default',
        isActive: true,
      },
    })
    console.log('✅ Created default tenant')
  }

  // Seed system roles for tenant
  const roles = await seedRoles(tenant.id)

  // Assign Owner role to existing admin if not already assigned
  if (existingAdmin) {
    console.log('✅ Admin user already exists!')
    console.log('   Email: admin@trimpro.com')
    
    const ownerRole = roles.find((r) => r.name === 'Owner')
    if (ownerRole) {
      const existingUserRole = await prisma.userRoleAssignment.findFirst({
        where: {
          userId: existingAdmin.id,
          roleId: ownerRole.id,
        },
      })
      
      if (!existingUserRole) {
        await prisma.userRoleAssignment.create({
          data: {
            userId: existingAdmin.id,
            roleId: ownerRole.id,
            assignedBy: existingAdmin.id,
          },
        })
        console.log('   ✅ Assigned Owner role to admin user')
      } else {
        console.log('   ✅ Admin already has Owner role')
      }
    }
    // Don't return - continue to create admin if needed
  }

  // Create admin user
  const passwordHash = await hashPassword('admin123')
  
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@trimpro.com',
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: passwordHash,
      lastPasswordChange: new Date(),
    },
  })

  // Assign Owner role to admin
  const ownerRole = roles.find((r) => r.name === 'Owner')
  if (ownerRole) {
    await prisma.userRoleAssignment.create({
      data: {
        userId: admin.id,
        roleId: ownerRole.id,
        assignedBy: admin.id,
      },
    })
    console.log('   ✅ Assigned Owner role to admin user')
  }

  console.log('✅ Admin user created successfully!')
  console.log('')
  console.log('📧 Login Credentials:')
  console.log('   Email: admin@trimpro.com')
  console.log('   Password: admin123')
  console.log('')
  console.log('⚠️  IMPORTANT: Change this password immediately after first login!')
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
