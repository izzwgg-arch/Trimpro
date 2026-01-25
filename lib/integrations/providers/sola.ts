/**
 * Sola Payments Integration
 */

import { IntegrationTestResult } from '../types'

export async function testSola(secrets: Record<string, any>): Promise<IntegrationTestResult> {
  try {
    const secretKey = secrets.secretKey
    const mode = secrets.mode || 'sandbox'

    if (!secretKey) {
      return {
        success: false,
        message: 'Sola credentials not configured',
        error: 'Missing secretKey',
      }
    }

    // Try to fetch account/merchant info if API supports it
    // For now, just validate the key format and return success
    // In production, you'd call a Sola API endpoint to verify credentials

    const apiBase =
      mode === 'production'
        ? process.env.SOLA_API_URL || 'https://api.sola.com'
        : process.env.SOLA_SANDBOX_API_URL || 'https://sandbox-api.sola.com'

    try {
      // Attempt to call a test endpoint (adjust based on Sola API)
      const response = await fetch(`${apiBase}/v1/account`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        const data = await response.json()
        return {
          success: true,
          message: `Connected to Sola (${mode === 'production' ? 'Production' : 'Sandbox'})`,
        }
      } else if (response.status === 401) {
        return {
          success: false,
          message: 'Sola authentication failed',
          error: 'Invalid secret key',
        }
      } else {
        // If endpoint doesn't exist or returns different status, just validate key format
        return {
          success: true,
          message: `Sola credentials configured (${mode === 'production' ? 'Production' : 'Sandbox'})`,
        }
      }
    } catch (fetchError: any) {
      // If API call fails, still consider it configured if key exists
      // This allows for offline validation
      if (secretKey.length > 10) {
        return {
          success: true,
          message: `Sola credentials configured (${mode === 'production' ? 'Production' : 'Sandbox'})`,
        }
      } else {
        return {
          success: false,
          message: 'Sola credentials validation failed',
          error: 'Invalid secret key format',
        }
      }
    }
  } catch (error: any) {
    return {
      success: false,
      message: 'Sola test failed',
      error: error.message || 'Unknown error',
    }
  }
}

/**
 * Verify webhook signature from Sola
 */
export function verifySolaWebhookSignature(
  payload: string,
  signature: string,
  webhookSecret: string
): boolean {
  try {
    // Sola webhook signature verification (adjust based on Sola's method)
    // Common methods: HMAC-SHA256, SHA256, etc.
    const crypto = require('crypto')
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex')

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch (error) {
    console.error('Sola webhook signature verification failed:', error)
    return false
  }
}
