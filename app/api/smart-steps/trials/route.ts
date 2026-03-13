import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const body = await request.json()

  // Batch upsert: body.trials = Trial[]
  const trials = Array.isArray(body.trials) ? body.trials : [body]

  // TODO: Prisma batch upsert
  // await prisma.abaTrial.createMany({ data: trials, skipDuplicates: true })

  const results = trials.map((t: any) => ({
    ...t,
    syncStatus: 'synced',
    therapistId: t.therapistId || user.id,
  }))

  return NextResponse.json({ synced: results.length, trials: results })
}

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId')
  const targetId = searchParams.get('targetId')
  const clientId = searchParams.get('clientId')

  // TODO: query Prisma
  return NextResponse.json({ trials: [], total: 0 })
}
