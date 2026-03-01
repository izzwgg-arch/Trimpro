/**
 * Script to add default mobile permissions to existing roles
 * Run with: npx tsx scripts/add-default-mobile-permissions.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const mobilePermissionsByRole: Record<string, string[]> = {
  Owner: [
    'mobile.access',
    'mobile.jobs.view_all',
    'mobile.schedule.view_all',
    'mobile.jobs.assign',
    'canCreateSchedulesForOthers',
    'mobile.jobs.complete',
    'mobile.tasks.create',
    'mobile.tasks.assign_to_any',
    'mobile.issues.create',
    'mobile.issues.assign_to_any',
    'mobile.messaging.enabled',
    'mobile.media.upload',
  ],
  Admin: [
    'mobile.access',
    'mobile.jobs.view_all',
    'mobile.schedule.view_all',
    'mobile.jobs.assign',
    'canCreateSchedulesForOthers',
    'mobile.jobs.complete',
    'mobile.tasks.create',
    'mobile.tasks.assign_to_any',
    'mobile.issues.create',
    'mobile.issues.assign_to_any',
    'mobile.messaging.enabled',
    'mobile.media.upload',
  ],
  Manager: [
    'mobile.access',
    'mobile.jobs.view_all',
    'mobile.schedule.view_all',
    'mobile.jobs.assign',
    'mobile.jobs.complete',
    'mobile.tasks.create',
    'mobile.tasks.assign_to_any',
    'mobile.issues.create',
    'mobile.issues.assign_to_any',
    'mobile.messaging.enabled',
    'mobile.media.upload',
  ],
  Dispatcher: [
    'mobile.access',
    'mobile.jobs.view_all',
    'mobile.schedule.view_all',
    'mobile.jobs.assign',
    'mobile.jobs.complete',
    'mobile.tasks.create',
    'mobile.tasks.assign_to_any',
    'mobile.issues.create',
    'mobile.issues.assign_to_any',
    'mobile.messaging.enabled',
    'mobile.media.upload',
  ],
  Tech: [
    'mobile.access',
    'mobile.jobs.view_assigned',
    'mobile.jobs.complete',
    'mobile.tasks.create',
    'mobile.tasks.assign_to_admin',
    'mobile.issues.create',
    'mobile.issues.assign_to_admin',
    'mobile.messaging.enabled',
    'mobile.media.upload',
  ],
  Accounting: [
    'mobile.access',
    'mobile.jobs.view_assigned',
    'mobile.messaging.enabled',
  ],
  ReadOnly: [
    'mobile.access',
    'mobile.jobs.view_assigned',
  ],
}

async function main() {
  console.log('🔄 Adding default mobile permissions to existing roles...')

  const tenants = await prisma.tenant.findMany()

  for (const tenant of tenants) {
    console.log(`\n📦 Processing tenant: ${tenant.name}`)

    const roles = await prisma.role.findMany({
      where: { tenantId: tenant.id },
    })

    for (const role of roles) {
      const defaultPerms = mobilePermissionsByRole[role.name] || ['mobile.access']
      const currentPerms = Array.isArray(role.mobilePermissions) ? (role.mobilePermissions as string[]) : []

      // Merge with existing permissions (don't overwrite if already set)
      const mergedPerms = currentPerms.length > 0 
        ? [...new Set([...currentPerms, ...defaultPerms])]
        : defaultPerms

      if (JSON.stringify(mergedPerms) !== JSON.stringify(currentPerms)) {
        await prisma.role.update({
          where: { id: role.id },
          data: { mobilePermissions: mergedPerms },
        })
        console.log(`   ✅ Updated role "${role.name}": ${mergedPerms.length} mobile permissions`)
      } else {
        console.log(`   ⏭️  Role "${role.name}" already has mobile permissions`)
      }
    }
  }

  console.log('\n✅ Done!')
}

main()
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
