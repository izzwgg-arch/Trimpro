import { prisma } from '@/lib/prisma'
import type { AuditAction } from '@prisma/client'

/**
 * Fire-and-forget audit log writer. Never throws — audit logging must not break
 * the operation it records. Mirrors the inline prisma.auditLog.create calls used
 * across the app, centralized so new call sites stay consistent.
 */
export async function recordAuditLog(input: {
  tenantId: string
  userId?: string | null
  action: AuditAction
  entityType: string
  entityId?: string | null
  changes?: any
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        changes: input.changes ?? undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
  } catch (err) {
    console.error('recordAuditLog failed (non-fatal):', err)
  }
}

/** Extract client IP + user agent from a request for audit context. */
export function auditContextFromRequest(request: Request): { ipAddress: string | null; userAgent: string | null } {
  const h = request.headers
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null
  return { ipAddress: ip, userAgent: h.get('user-agent') || null }
}
