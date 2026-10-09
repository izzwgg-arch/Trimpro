/**
 * Direct Cardknox gateway client for MERCHANT-INITIATED actions:
 *  - cc:save  — vault a card (from an iFields one-time token) into a reusable xToken
 *  - cc:sale  — charge a saved xToken on a schedule (customer not present)
 *
 * Requires the secret transaction key in CARDKNOX_XKEY (server-side only; never
 * sent to the browser). The raw PAN never touches our server — the front-end
 * tokenizes the card with Cardknox iFields and we only ever handle tokens.
 */

const GATEWAY_URL =
  process.env.CARDKNOX_GATEWAY_URL || 'https://x1.cardknox.com/gatewayjson'
const X_KEY = process.env.CARDKNOX_XKEY || ''
const X_VERSION = '5.0.0'

export function cardknoxConfigured(): boolean {
  return Boolean(X_KEY)
}

export interface SavedCard {
  token: string
  maskedCard: string | null
  cardType: string | null
  expMonth: number | null
  expYear: number | null
  refNum: string | null
}

export interface ChargeResult {
  refNum: string | null
  authCode: string | null
  maskedCard: string | null
  cardType: string | null
  amount: number
  raw: Record<string, any>
}

function parseExp(xExp?: string): { expMonth: number | null; expYear: number | null } {
  const s = String(xExp || '').replace(/\D/g, '')
  if (s.length !== 4) return { expMonth: null, expYear: null }
  const mm = parseInt(s.slice(0, 2), 10)
  const yy = parseInt(s.slice(2), 10)
  return {
    expMonth: Number.isFinite(mm) ? mm : null,
    expYear: Number.isFinite(yy) ? 2000 + yy : null,
  }
}

async function cardknoxRequest(payload: Record<string, any>): Promise<Record<string, any>> {
  if (!X_KEY) {
    throw new Error('Cardknox is not configured (CARDKNOX_XKEY missing).')
  }
  const body = {
    xKey: X_KEY,
    xVersion: X_VERSION,
    xSoftwareName: 'TrimPro',
    xSoftwareVersion: '1.0',
    ...payload,
  }
  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: Record<string, any>
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Cardknox returned a non-JSON response (HTTP ${res.status}).`)
  }
  // Cardknox returns HTTP 200 even on decline/error — the real outcome is xResult.
  const result = String(json.xResult || '')
  if (result !== 'A') {
    const err = String(json.xError || 'Unknown gateway error')
    const code = json.xErrorCode ? ` (code ${json.xErrorCode})` : ''
    throw new Error(`Cardknox declined: ${err}${code}`)
  }
  return json
}

/**
 * Vault a card from a Cardknox iFields one-time card token into a reusable
 * xToken we can charge later. No money is moved.
 */
export async function saveCardFromIfieldsToken(input: {
  cardToken: string // iFields xCardNum token
  exp: string // MMYY
  name?: string
  zip?: string
  cvvToken?: string // iFields xCVV token (optional, improves save success)
}): Promise<SavedCard> {
  const json = await cardknoxRequest({
    xCommand: 'cc:save',
    xCardNum: input.cardToken,
    xExp: String(input.exp || '').replace(/\D/g, ''),
    ...(input.cvvToken ? { xCVV: input.cvvToken } : {}),
    ...(input.name ? { xName: input.name } : {}),
    ...(input.zip ? { xZip: input.zip } : {}),
  })
  const { expMonth, expYear } = parseExp(json.xExp || input.exp)
  return {
    token: String(json.xToken || ''),
    maskedCard: json.xMaskedCardNumber || null,
    cardType: json.xCardType || null,
    expMonth,
    expYear,
    refNum: json.xRefNum || null,
  }
}

/**
 * Charge a previously-saved card token. Marked as a recurring / merchant-
 * initiated transaction (the cardholder is not present).
 */
export async function chargeSavedCard(input: {
  token: string
  amount: number
  invoiceNumber?: string
  description?: string
  name?: string
  email?: string
  intentRef?: string
}): Promise<ChargeResult> {
  const amount = Math.round(Number(input.amount) * 100) / 100
  if (!(amount > 0)) throw new Error('Charge amount must be greater than zero.')

  const json = await cardknoxRequest({
    xCommand: 'cc:sale',
    xToken: input.token,
    xAmount: amount.toFixed(2),
    xRecurring: 'True', // merchant-initiated / stored-credential recurring
    ...(input.invoiceNumber ? { xInvoice: input.invoiceNumber } : {}),
    ...(input.description ? { xDescription: input.description } : {}),
    ...(input.name ? { xName: input.name } : {}),
    ...(input.email ? { xEmail: input.email } : {}),
    ...(input.intentRef ? { xCustom1: input.intentRef } : {}),
  })
  return {
    refNum: json.xRefNum || null,
    authCode: json.xAuthCode || null,
    maskedCard: json.xMaskedCardNumber || null,
    cardType: json.xCardType || null,
    amount,
    raw: json,
  }
}
