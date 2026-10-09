/**
 * Read-only connectivity/auth check for the Cardknox xKey.
 * Runs a cc:save (tokenize-only, NO money movement) with a test card and
 * prints ONLY safe result fields — never the key, never a full card number.
 *
 * Run (on the server, after CARDKNOX_XKEY is in env):
 *   npx tsx scripts/cardknox-key-check.mjs
 */
const xKey = process.env.CARDKNOX_XKEY
if (!xKey) {
  console.error('CARDKNOX_XKEY not set in env')
  process.exit(1)
}

const endpoint = 'https://x1.cardknox.com/gatewayjson'
const payload = {
  xKey,
  xVersion: '5.0.0',
  xSoftwareName: 'TrimPro',
  xSoftwareVersion: '1.0',
  xCommand: 'cc:save',
  xCardNum: '4111111111111111', // well-known test card; cc:save does not charge
  xExp: '1230',
}

try {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    console.log('HTTP', res.status, 'non-JSON response (first 200 chars):', text.slice(0, 200))
    process.exit(0)
  }
  const safe = {
    httpStatus: res.status,
    xResult: json.xResult,
    xStatus: json.xStatus,
    xError: json.xError,
    xErrorCode: json.xErrorCode,
    gotToken: Boolean(json.xToken),
    tokenPrefix: json.xToken ? String(json.xToken).slice(0, 6) + '…' : null,
    maskedCard: json.xMaskedCardNumber || null,
    cardType: json.xCardType || null,
    refNum: json.xRefNum || null,
  }
  console.log(JSON.stringify(safe, null, 2))
} catch (err) {
  console.error('Request failed:', err?.message || err)
  process.exit(1)
}
