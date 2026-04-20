import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/qbo/sync-failures
 *
 * Returns recent QuickBooks sync failures for the current tenant.
 * Admin-only.
 *
 * Query params:
 *   since  – ISO timestamp; only return failures created after this time.
 *            Defaults to 24 hours ago.
 *   limit  – max rows to return (default 20)
 */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const sinceParam = searchParams.get('since')
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 20)))

    const since = sinceParam
      ? new Date(sinceParam)
      : new Date(Date.now() - 24 * 60 * 60 * 1000)

    // Find the integration for this tenant
    const integration = await prisma.quickBooksIntegration.findUnique({
      where: { tenantId: user.tenantId },
      select: { id: true },
    })

    if (!integration) {
      return NextResponse.json({ failures: [], total: 0 })
    }

    // Fetch recent error rows, deduplicated to the latest per (type, entityId)
    const rows = await prisma.quickBooksSyncLog.findMany({
      where: {
        integrationId: integration.id,
        status: 'error',
        createdAt: { gt: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 200, // over-fetch then deduplicate
      select: {
        id: true,
        type: true,
        action: true,
        entityId: true,
        error: true,
        createdAt: true,
      },
    })

    // Keep only the newest row per (type + entityId) to avoid spamming
    const seen = new Set<string>()
    const deduped: typeof rows = []
    for (const row of rows) {
      const key = `${row.type}:${row.entityId ?? '__none__'}`
      if (!seen.has(key)) {
        seen.add(key)
        deduped.push(row)
        if (deduped.length >= limit) break
      }
    }

    const failures = deduped.map((row) => ({
      id: row.id,
      type: row.type,
      action: row.action,
      entityId: row.entityId,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    }))

    return NextResponse.json({ failures, total: failures.length })
  } catch (error: any) {
    console.error('QBO sync-failures fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
