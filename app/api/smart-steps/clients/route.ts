import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { MOCK_CLIENTS } from '@/lib/smart-steps/mock-data'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const diagnosis = searchParams.get('diagnosis') ?? ''

  let clients = MOCK_CLIENTS
  if (search) {
    const q = search.toLowerCase()
    clients = clients.filter((c) =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      c.diagnosisTags.some((d) => d.toLowerCase().includes(q))
    )
  }
  if (diagnosis) {
    clients = clients.filter((c) => c.diagnosisTags.includes(diagnosis))
  }

  return NextResponse.json({ clients, total: clients.length })
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const body = await request.json()

  // TODO: validate with zod + insert via Prisma
  const newClient = {
    id: `c_${Date.now()}`,
    ...body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    overallProgress: 0,
    masteredTargets: 0,
    totalTargets: 0,
    sessionsThisWeek: 0,
  }

  return NextResponse.json({ client: newClient }, { status: 201 })
}
