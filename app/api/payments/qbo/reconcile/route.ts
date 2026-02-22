import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { reconcileTenantRecentAchPayments } from '@/lib/qbo/reconcile-ach'

export const runtime = 'nodejs'

function isAuthorized(request: NextRequest): boolean {
  const secret = String(process.env.QBO_ACH_RECONCILE_SECRET || '').trim()
  if (!secret) return false

  const auth = String(request.headers.get('authorization') || '')
  const tokenFromAuth = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : ''
  const tokenFromHeader = String(request.headers.get('x-reconcile-secret') || '').trim()
  const tokenFromQuery = String(request.nextUrl.searchParams.get('secret') || '').trim()
  const provided = tokenFromAuth || tokenFromHeader || tokenFromQuery
  if (!provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const recentWindow = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
  const pending = await prisma.invoicePaymentIntent.findMany({
    where: {
      provider: 'qbo',
      method: 'ach',
      status: { in: ['CREATED', 'LINK_CREATED', 'PENDING'] as any },
      createdAt: { gte: recentWindow },
    },
    select: { tenantId: true },
    distinct: ['tenantId'],
    take: 200,
  })

  let ok = 0
  let failed = 0
  for (const row of pending) {
    try {
      await reconcileTenantRecentAchPayments(row.tenantId)
      ok += 1
    } catch (e) {
      failed += 1
      console.error('[QBO ACH] Cron reconcile tenant failed:', row.tenantId, e)
    }
  }

  return NextResponse.json({
    ok: true,
    tenantsScanned: pending.length,
    tenantsSucceeded: ok,
    tenantsFailed: failed,
  })
}

