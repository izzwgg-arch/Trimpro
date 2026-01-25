// SOLA Payment API Integration
// Documentation: https://sola.com/api/docs

const SOLA_API_BASE = process.env.SOLA_API_URL || 'https://api.sola.com'
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
  private async makeRequest(endpoint: string, method: string, body?: any): Promise<any> {
    const url = `${SOLA_API_BASE}${endpoint}`
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SOLA_API_KEY}`,
      'X-API-Key': SOLA_API_KEY || '',
      'X-API-Secret': SOLA_API_SECRET || '',
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
    return this.makeRequest('/v1/payment-links', 'POST', {
      amount: request.amount,
      currency: 'USD',
      description: request.description,
      metadata: {
        invoiceId: request.invoiceId,
      },
      customer: request.clientEmail ? {
        email: request.clientEmail,
        name: request.clientName,
      } : undefined,
      returnUrl: request.returnUrl,
      webhookUrl: request.webhookUrl,
    })
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
