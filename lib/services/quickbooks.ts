// QuickBooks Online API Integration
// OAuth 2.0 with refresh token support

const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI || 'http://localhost:3000/api/qbo/callback'
const QBO_BASE_URL = 'https://appcenter.intuit.com/connect/oauth2'
const QBO_API_BASE = 'https://sandbox-quickbooks.api.intuit.com' // Use production URL in production

interface QBOAccessTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  realmId: string
}

interface QBOCompanyInfo {
  CompanyName: string
  CompanyAddr: any
  LegalAddr: any
  SupportedLanguages: string
}

export class QuickBooksService {
  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: QBO_CLIENT_ID || '',
      scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: QBO_REDIRECT_URI,
      response_type: 'code',
      access_type: 'offline',
      state: state || '',
    })

    return `${QBO_BASE_URL}?${params.toString()}`
  }

  async exchangeCodeForTokens(code: string): Promise<QBOAccessTokenResponse> {
    const response = await fetch(`${QBO_BASE_URL}/v1/tokens/bearer`, {
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

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(error.error_description || error.message || 'Failed to exchange code for tokens')
    }

    return response.json()
  }

  async refreshAccessToken(refreshToken: string): Promise<Omit<QBOAccessTokenResponse, 'realmId'>> {
    const response = await fetch(`${QBO_BASE_URL}/v1/tokens/bearer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(error.error_description || error.message || 'Failed to refresh token')
    }

    return response.json()
  }

  async makeAPIRequest(
    accessToken: string,
    realmId: string,
    endpoint: string,
    method: string = 'GET',
    body?: any
  ): Promise<any> {
    const url = `${QBO_API_BASE}/v3/company/${realmId}${endpoint}`
    
    const headers: HeadersInit = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    }

    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(error.fault?.error?.[0]?.Detail || error.message || 'QuickBooks API error')
    }

    return response.json()
  }

  async getCompanyInfo(accessToken: string, realmId: string): Promise<QBOCompanyInfo> {
    const response = await this.makeAPIRequest(accessToken, realmId, '/companyinfo/${realmId}')
    return response.QueryResponse?.CompanyInfo?.[0] || response.CompanyInfo
  }

  async createCustomer(accessToken: string, realmId: string, customerData: any): Promise<any> {
    return this.makeAPIRequest(accessToken, realmId, '/customer', 'POST', customerData)
  }

  async updateCustomer(accessToken: string, realmId: string, customerId: string, customerData: any): Promise<any> {
    return this.makeAPIRequest(accessToken, realmId, `/customer?operation=update`, 'POST', {
      ...customerData,
      Id: customerId,
      SyncToken: customerData.SyncToken || '0',
    })
  }

  async createInvoice(accessToken: string, realmId: string, invoiceData: any): Promise<any> {
    return this.makeAPIRequest(accessToken, realmId, '/invoice', 'POST', invoiceData)
  }

  async createPayment(accessToken: string, realmId: string, paymentData: any): Promise<any> {
    return this.makeAPIRequest(accessToken, realmId, '/payment', 'POST', paymentData)
  }

  async createItem(accessToken: string, realmId: string, itemData: any): Promise<any> {
    return this.makeAPIRequest(accessToken, realmId, '/item', 'POST', itemData)
  }

  async query(accessToken: string, realmId: string, query: string): Promise<any> {
    return this.makeAPIRequest(accessToken, realmId, `/query?query=${encodeURIComponent(query)}`)
  }
}

export const quickBooksService = new QuickBooksService()
