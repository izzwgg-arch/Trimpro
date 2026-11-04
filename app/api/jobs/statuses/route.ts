import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { getProductionConfigForTenant } from '@/lib/production/settings'
import { jobStatusCatalog } from '@/lib/production/config'

// The tenant's job status catalog (built-in + custom), for status pickers.
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)

  try {
    const config = await getProductionConfigForTenant(user.tenantId)
    return NextResponse.json(
      { statuses: jobStatusCatalog(config) },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return NextResponse.json({ statuses: jobStatusCatalog(null) })
  }
}
