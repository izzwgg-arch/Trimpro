import { prisma } from '@/lib/prisma'
import {
  buildDefaultProductionConfig,
  mergeProductionConfig,
  type ProductionConfig,
} from '@/lib/production/config'

/**
 * Load the effective Production config for a tenant: stored overrides merged
 * over the defaults. Always returns a complete, valid config so the board
 * works even when nothing has been configured.
 */
export async function getProductionConfigForTenant(tenantId: string): Promise<ProductionConfig> {
  try {
    const row = await prisma.productionSettings.findUnique({ where: { tenantId } })
    return mergeProductionConfig(row?.config ?? null)
  } catch (err) {
    // If the table/model isn't available yet, fall back to defaults rather
    // than breaking the board.
    console.error('getProductionConfigForTenant failed, using defaults:', err)
    return buildDefaultProductionConfig()
  }
}

/** Persist a full config for a tenant (upsert), returning the merged result. */
export async function saveProductionConfigForTenant(
  tenantId: string,
  config: ProductionConfig
): Promise<ProductionConfig> {
  const clean = mergeProductionConfig(config) // normalize before storing
  await prisma.productionSettings.upsert({
    where: { tenantId },
    create: { tenantId, config: clean as any },
    update: { config: clean as any },
  })
  return clean
}

/** Reset a tenant back to the derived defaults. */
export async function resetProductionConfigForTenant(tenantId: string): Promise<ProductionConfig> {
  const defaults = buildDefaultProductionConfig()
  await prisma.productionSettings.upsert({
    where: { tenantId },
    create: { tenantId, config: defaults as any },
    update: { config: defaults as any },
  })
  return defaults
}
