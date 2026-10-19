import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requirePermission } from '@/lib/authorization'
import { getViewPrefs, saveViewPrefs, normalizeViewPrefs } from '@/lib/production/view-preferences'

// GET — the signed-in user's personal production-line view preferences.
export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'production.view')
  if (permError) return permError
  const user = getAuthUser(request)
  try {
    const prefs = await getViewPrefs(user.tenantId, user.id)
    return NextResponse.json({ prefs })
  } catch (error) {
    console.error('Get production view prefs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT — save the signed-in user's own view preferences (display only).
export async function PUT(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requirePermission(request, 'production.view')
  if (permError) return permError
  const user = getAuthUser(request)
  try {
    const body = await request.json().catch(() => ({}))
    const prefs = await saveViewPrefs(user.tenantId, user.id, normalizeViewPrefs(body?.prefs ?? body))
    return NextResponse.json({ prefs })
  } catch (error) {
    console.error('Save production view prefs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
