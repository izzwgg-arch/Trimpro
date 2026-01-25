/**
 * QuickBooks Online Integration
 * OAuth 2.0 connection test
 */

import { IntegrationTestResult } from '../types'
import { decryptSecrets } from '../../integrations/secrets'

export async function testQuickBooks(secrets: Record<string, any>): Promise<IntegrationTestResult> {
  try {
    const refreshToken = secrets.refreshToken
    const realmId = secrets.realmId

    if (!refreshToken) {
      return {
        success: false,
        message: 'QuickBooks not connected',
        error: 'No refresh token found. Please connect QuickBooks first.',
      }
    }

    // Try to get access token using refresh token
    const accessTokenResult = await refreshQuickBooksToken(secrets)

    if (!accessTokenResult.success) {
      return {
        success: false,
        message: 'QuickBooks connection failed',
        error: accessTokenResult.error || 'Failed to refresh access token',
      }
    }

    // Try to fetch company info
    const companyInfo = await fetchQuickBooksCompany(accessTokenResult.accessToken!, realmId || secrets.realmId)

    if (!companyInfo.success) {
      return {
        success: false,
        message: 'QuickBooks connection test failed',
        error: companyInfo.error || 'Failed to fetch company info',
      }
    }

    return {
      success: true,
      message: `Connected to QuickBooks company: ${companyInfo.companyName || 'Unknown'}`,
    }
  } catch (error: any) {
    return {
      success: false,
      message: 'QuickBooks test failed',
      error: error.message || 'Unknown error',
    }
  }
}

async function refreshQuickBooksToken(secrets: Record<string, any>): Promise<{
  success: boolean
  accessToken?: string
  error?: string
}> {
  try {
    const clientId = process.env.QBO_CLIENT_ID
    const clientSecret = process.env.QBO_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: 'QBO_CLIENT_ID and QBO_CLIENT_SECRET must be configured',
      }
    }

    const refreshToken = secrets.refreshToken

    const response = await fetch('https://appcenter.intuit.com/connect/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        error: `Token refresh failed: ${response.status} - ${error}`,
      }
    }

    const data = await response.json()
    return {
      success: true,
      accessToken: data.access_token,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error',
    }
  }
}

async function fetchQuickBooksCompany(
  accessToken: string,
  realmId?: string
): Promise<{ success: boolean; companyName?: string; error?: string }> {
  try {
    if (!realmId) {
      return {
        success: false,
        error: 'Realm ID not found',
      }
    }

    const baseUrl = process.env.QBO_ENV === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com'

    const response = await fetch(`${baseUrl}/v3/company/${realmId}/companyinfo/${realmId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        error: `Failed to fetch company: ${response.status} - ${error}`,
      }
    }

    const data = await response.json()
    const company = data.QueryResponse?.CompanyInfo?.[0] || data.CompanyInfo

    return {
      success: true,
      companyName: company?.CompanyName,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error',
    }
  }
}
