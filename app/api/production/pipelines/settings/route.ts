import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { getPipelineConfigForTenant, savePipelineConfigForTenant } from '@/lib/production/pipeline-data'
import { buildDefaultPipelineConfig } from '@/lib/production/pipelines'

/** Company settings for the Estimate / Invoice pipelines (separate from the Jobs production line settings). */
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'production.view')
  if (permError) return permError
  const user = getAuthUser(request)
  const config = await getPipelineConfigForTenant(user.tenantId)
  return NextResponse.json({ config, defaults: buildDefaultPipelineConfig() })
}

export async function PUT(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'production.manage')
  if (permError) return permError
  const user = getAuthUser(request)
  try {
    const body = await request.json()
    const config = await savePipelineConfigForTenant(user.tenantId, body?.config)
    return NextResponse.json({ config })
  } catch (error) {
    console.error('Save pipeline settings error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
