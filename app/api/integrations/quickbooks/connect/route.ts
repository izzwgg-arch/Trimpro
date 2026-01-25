import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import crypto from 'crypto'

const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET
const QBO_REDIRECT_URI =
  process.env.QBO_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/integrations/quickbooks/callback`
const QBO_BASE_URL = 'https://appcenter.intuit.com/connect/oauth2'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  if (!QBO_CLIENT_ID) {
    return NextResponse.json({ error: 'QBO_CLIENT_ID not configured' }, { status: 500 })
  }

  // Generate state token for CSRF protection
  const state = crypto.randomBytes(32).toString('hex')

  // Store state in session/cookie (simplified - in production use secure session)
  // For now, include tenant ID in state
  const stateWithTenant = `${state}:${user.tenantId}`

  const params = new URLSearchParams({
    client_id: QBO_CLIENT_ID,
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: QBO_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    state: stateWithTenant,
  })

  const authUrl = `${QBO_BASE_URL}?${params.toString()}`

  // Check if request wants JSON (from client-side fetch with Authorization header)
  const acceptHeader = request.headers.get('accept') || ''
  if (acceptHeader.includes('application/json')) {
    return NextResponse.json({ authUrl, state })
  }

  // Otherwise redirect directly (for direct browser navigation)
  return NextResponse.redirect(authUrl)
}
