/**
 * Read-only: inspect recent SOLA/Cardknox card payments to see whether the
 * stored gateway payload (solaWebhookData / rawPayload) contains a reusable
 * card token (xToken) + masked card. Confirms the card-on-file capture path.
 *
 * Run: npx tsx scripts/inspect-sola-token.mjs [--limit=20]
 */
import { PrismaClient } from '@prisma/client'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  })
)
const limit = Number(args.limit || 20)
const p = new PrismaClient()

const payments = await p.payment.findMany({
  where: { provider: 'sola' },
  orderBy: { createdAt: 'desc' },
  take: limit,
  select: { id: true, createdAt: true, solaWebhookData: true, rawPayload: true },
})

const TOKEN_KEYS = ['xToken', 'xtoken', 'Token', 'token', 'PaymentMethodToken', 'CardToken']
const MASK_KEYS = ['xMaskedCardNumber', 'MaskedCardNumber', 'xCardType', 'CardType', 'xMaskedAccountNumber']

let withToken = 0
const rows = []
for (const pay of payments) {
  const blob = { ...(pay.solaWebhookData || {}), ...(pay.rawPayload || {}) }
  const keys = Object.keys(blob)
  const tokenKey = TOKEN_KEYS.find((k) => blob[k])
  const maskKey = MASK_KEYS.find((k) => blob[k])
  if (tokenKey) withToken += 1
  rows.push({
    id: pay.id,
    createdAt: pay.createdAt,
    hasToken: Boolean(tokenKey),
    tokenKey: tokenKey || null,
    tokenSample: tokenKey ? String(blob[tokenKey]).slice(0, 6) + '…' : null,
    mask: maskKey ? String(blob[maskKey]) : null,
    allKeys: keys,
  })
}

console.log(`Inspected ${payments.length} recent SOLA payment(s); ${withToken} contain a token field.`)
console.log(JSON.stringify(rows, null, 2))
await p.$disconnect()
