import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptSecrets, encryptSecrets } from '@/lib/integrations/secrets'
import { updateIntegrationStatus } from '@/lib/integrations/status'

async function getQuickBooksConfig(tenantId: string) {
  const connection = await prisma.integrationConnection.findUnique({
    where: {
      tenantId_provider: {
        tenantId,
        provider: 'quickbooks',
      },
    },
  })

  let saved: Record<string, any> = {}
  if (connection?.encryptedSecrets) {
    try {
      saved = decryptSecrets(connection.encryptedSecrets)
    } catch (error) {
      console.error('Failed to decrypt saved QuickBooks secrets')
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000'
  const clientId = saved.clientId || process.env.QBO_CLIENT_ID || ''
  const clientSecret = saved.clientSecret || process.env.QBO_CLIENT_SECRET || ''
  const redirectUri = saved.redirectUri || process.env.QBO_REDIRECT_URI || `${appUrl}/api/integrations/quickbooks/callback`
  const environment = saved.environment || process.env.QBO_ENV || 'production'

  return { clientId, clientSecret, redirectUri, environment, connection, saved }
}

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

    const cfg = await getQuickBooksConfig(tenantId)
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error('QuickBooks credentials missing. Save Client ID and Client Secret first.')
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://appcenter.intuit.com/connect/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
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
      ...cfg.saved,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUri: cfg.redirectUri,
      environment: cfg.environment,
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

    // Also update QuickBooksIntegration table for backwards compatibility (store plaintext tokens)
    await prisma.quickBooksIntegration.upsert({
      where: { tenantId },
      create: {
        tenantId,
        isConnected: true,
        refreshToken: refresh_token,
        accessToken: access_token,
        tokenExpiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
        realmId,
      },
      update: {
        isConnected: true,
        refreshToken: refresh_token,
        accessToken: access_token,
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
