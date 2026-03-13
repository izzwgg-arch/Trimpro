import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const body = await request.json()
  const queue: Array<{ id: string; type: string; operation: string; payload: any; timestamp: string }> = body.queue ?? []

  const results: Array<{ id: string; status: 'synced' | 'conflict' | 'error'; error?: string }> = []
  const conflicts: any[] = []

  for (const item of queue) {
    try {
      // Timestamp-based last-write-wins conflict resolution
      // TODO: real DB operations
      // const existing = await prisma[item.type].findUnique({ where: { id: item.payload.id } })
      // if (existing && existing.updatedAt > item.timestamp) {
      //   conflicts.push({ queued: item.payload, server: existing })
      //   results.push({ id: item.id, status: 'conflict' })
      //   continue
      // }
      results.push({ id: item.id, status: 'synced' })
    } catch (err: any) {
      results.push({ id: item.id, status: 'error', error: err?.message ?? 'Unknown error' })
    }
  }

  return NextResponse.json({
    processed: results.length,
    synced: results.filter((r) => r.status === 'synced').length,
    conflicts: conflicts.length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
    conflictItems: conflicts,
  })
}
