import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encryptSecrets } from '@/lib/integrations/secrets'
import { updateIntegrationStatus } from '@/lib/integrations/status'

const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET
const QBO_REDIRECT_URI =
  process.env.QBO_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/integrations/quickbooks/callback`

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const realmId = searchParams.get('realmId')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      `/dashboard/settings/integrations/quickbooks?error=${encodeURIComponent(error)}`
    )
  }

  if (!code || !state || !realmId) {
    return NextResponse.redirect(
      `/dashboard/settings/integrations/quickbooks?error=${encodeURIComponent('Missing required parameters')}`
    )
  }

  try {
    // Extract tenant ID from state
    const [stateToken, tenantId] = state.split(':')
    if (!tenantId) {
      throw new Error('Invalid state token')
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://appcenter.intuit.com/connect/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: QBO_REDIRECT_URI,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      throw new Error(`Token exchange failed: ${errorText}`)
    }

    const tokenData = await tokenResponse.json()
    const { access_token, refresh_token, expires_in } = tokenData

    // Encrypt and store tokens
    const secrets = {
      refreshToken: refresh_token,
      realmId,
      accessToken: access_token,
      tokenExpiresAt: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null,
    }

    const encryptedSecrets = encryptSecrets(secrets)

    // Save to IntegrationConnection
    await prisma.integrationConnection.upsert({
      where: {
        tenantId_provider: {
          tenantId,
          provider: 'quickbooks',
        },
      },
      create: {
        tenantId,
        provider: 'quickbooks',
        status: 'CONNECTED',
        encryptedSecrets,
        metadata: {
          realmId,
          connectedAt: new Date().toISOString(),
        },
        lastCheckedAt: new Date(),
      },
      update: {
        status: 'CONNECTED',
        encryptedSecrets,
        metadata: {
          realmId,
          connectedAt: new Date().toISOString(),
        },
        lastCheckedAt: new Date(),
        lastError: null,
      },
    })

    // Also update QuickBooksIntegration table for backwards compatibility
    await prisma.quickBooksIntegration.upsert({
      where: { tenantId },
      create: {
        tenantId,
        isConnected: true,
        refreshToken: encryptSecrets({ refreshToken: refresh_token }),
        accessToken: encryptSecrets({ accessToken: access_token }),
        tokenExpiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
        realmId,
      },
      update: {
        isConnected: true,
        refreshToken: encryptSecrets({ refreshToken: refresh_token }),
        accessToken: encryptSecrets({ accessToken: access_token }),
        tokenExpiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
        realmId,
      },
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: 'CREATE',
        entityType: 'IntegrationConnection',
        changes: {
          provider: 'quickbooks',
          action: 'connected',
        },
      },
    })

    return NextResponse.redirect('/dashboard/settings/integrations/quickbooks?success=connected')
  } catch (error: any) {
    console.error('QuickBooks callback error:', error)
    return NextResponse.redirect(
      `/dashboard/settings/integrations/quickbooks?error=${encodeURIComponent(error.message || 'Connection failed')}`
    )
  }
}
