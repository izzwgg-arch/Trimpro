// SOLA/Cardknox Payment API Integration

const SOLA_API_BASE =
  process.env.SOLA_API_URL ||
  process.env.SOLA_API_BASE_URL ||
  process.env.CARDKNOX_API_BASE_URL ||
  'https://api.cardknox.com/v2'
const CARDKNOX_HOSTED_FORM_URL =
  process.env.CARDKNOX_HOSTED_FORM_URL || 'https://secure.cardknox.com/trimprony'
const SOLA_API_KEY = process.env.SOLA_API_KEY
const SOLA_API_SECRET = process.env.SOLA_API_SECRET

interface SolaPaymentLinkRequest {
  invoiceId: string
  amount: number
  description: string
  clientEmail?: string
  clientName?: string
  returnUrl?: string
  webhookUrl?: string
  apiKey?: string
  apiSecret?: string
}

interface SolaPaymentLinkResponse {
  id: string
  url: string
  expiresAt: string
}

interface SolaWebhookPayload {
  event: string
  paymentId: string
  invoiceId: string
  amount: number
  status: string
  transactionId: string
  timestamp: string
  signature: string
}

export class SolaService {
  private async makeRequest(
    endpoint: string,
    method: string,
    body?: any,
    credentials?: { apiKey?: string; apiSecret?: string }
  ): Promise<any> {
    const url = `${SOLA_API_BASE}${endpoint}`
    const apiKey = credentials?.apiKey || SOLA_API_KEY
    const apiSecret = credentials?.apiSecret || SOLA_API_SECRET
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': apiKey ? `Bearer ${apiKey}` : '',
      'X-API-Key': apiKey || '',
      'X-API-Secret': apiSecret || '',
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(error.message || `SOLA API error: ${response.statusText}`)
    }

    return response.json()
  }

  async createPaymentLink(request: SolaPaymentLinkRequest): Promise<SolaPaymentLinkResponse> {
    const amountCents = Math.round((request.amount || 0) * 100)
    const v2Payload = {
      xCommand: 'cc:sale',
      xInvoice: request.invoiceId,
      xAmount: (amountCents / 100).toFixed(2),
      amountCents,
      description: request.description,
      metadata: {
        invoiceId: request.invoiceId,
      },
      customer: request.clientEmail
        ? {
            email: request.clientEmail,
            name: request.clientName,
          }
        : undefined,
      returnUrl: request.returnUrl,
      webhookUrl: request.webhookUrl,
    }
    const v1Payload = {
      amount: request.amount,
      currency: 'USD',
      description: request.description,
      metadata: {
        invoiceId: request.invoiceId,
      },
      customer: request.clientEmail
        ? {
            email: request.clientEmail,
            name: request.clientName,
          }
        : undefined,
      returnUrl: request.returnUrl,
      webhookUrl: request.webhookUrl,
    }

    const attempts: Array<{ endpoint: string; payload: any }> = [
      { endpoint: '/payment-links', payload: v2Payload },
      { endpoint: '/v1/payment-links', payload: v1Payload },
      { endpoint: '/v2/payment-links', payload: v2Payload },
    ]
    let lastError: Error | null = null

    for (const attempt of attempts) {
      try {
        const raw = await this.makeRequest(attempt.endpoint, 'POST', attempt.payload, {
          apiKey: request.apiKey,
          apiSecret: request.apiSecret,
        })
        const url = String(
          raw?.url || raw?.paymentUrl || raw?.PaymentURL || raw?.link?.url || raw?.data?.url || ''
        )
        if (url) {
          return {
            id: String(raw.id || raw.transactionId || raw.TransactionID || raw.xRefnum || request.invoiceId),
            url,
            expiresAt: String(
              raw.expiresAt ||
                raw.expiration ||
                raw.link?.expiresAt ||
                new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
            ),
          }
        }
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }

    // Fallback to merchant-hosted Cardknox payment page if API does not return a dynamic URL.
    // This keeps the payment flow usable while preserving API diagnostics in logs.
    if (CARDKNOX_HOSTED_FORM_URL) {
      console.warn(
        `Sola did not return a hosted payment URL. Falling back to CARDKNOX_HOSTED_FORM_URL. ${lastError ? `Last error: ${lastError.message}` : ''}`.trim()
      )
      return {
        id: request.invoiceId,
        url: CARDKNOX_HOSTED_FORM_URL,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      }
    }

    throw new Error(
      `Sola did not return a hosted payment URL. ${lastError ? `Last error: ${lastError.message}` : ''}`.trim()
    )
  }

  async getPaymentStatus(paymentId: string): Promise<any> {
    return this.makeRequest(`/v1/payments/${paymentId}`, 'GET')
  }

  async refundPayment(paymentId: string, amount?: number): Promise<any> {
    return this.makeRequest(`/v1/payments/${paymentId}/refund`, 'POST', {
      amount,
    })
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    // Verify webhook signature
    // Implementation depends on SOLA's signature algorithm
    // This is a placeholder
    if (!SOLA_API_SECRET) return false

    // TODO: Implement HMAC verification
    // const expectedSignature = crypto
    //   .createHmac('sha256', SOLA_API_SECRET)
    //   .update(payload)
    //   .digest('hex')
    
    return true // Placeholder
  }
}

export const solaService = new SolaService()
