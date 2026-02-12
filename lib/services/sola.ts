// SOLA/Cardknox Payment API Integration

const SOLA_API_BASE =
  process.env.SOLA_API_URL ||
  process.env.SOLA_API_BASE_URL ||
  process.env.CARDKNOX_API_BASE_URL ||
  'https://api.cardknox.com/v2'
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
    const amountCents = Math.round((request.amount || 0) * 100)
    const payload = {
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

    const raw = await this.makeRequest('/payment-links', 'POST', payload)

    // Normalize multiple possible provider response shapes.
    return {
      id: String(raw.id || raw.transactionId || raw.TransactionID || raw.refNum || request.invoiceId),
      url: String(raw.url || raw.paymentUrl || raw.PaymentURL || ''),
      expiresAt: String(
        raw.expiresAt ||
          raw.expiration ||
          new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
      ),
    }
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
