import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { encryptToken, decryptToken } from '@/lib/security/token-encryption'

const APPROVAL_TOKEN_BYTES = 32 // 256-bit
const DEFAULT_EXPIRY_DAYS = 90

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(String(input)).digest('hex')
}

export function hashApprovalToken(rawToken: string): string {
  return sha256Hex(rawToken)
}

export function buildPublicApproveEstimateUrl(rawToken: string): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://app.trimprony.com'
  return `${String(appUrl).replace(/\/$/, '')}/approve/estimate/${rawToken}`
}

export async function getOrCreateEstimateApprovalToken(params: {
  tenantId: string
  estimateId: string
  expiresInDays?: number
}): Promise<{ rawToken: string; url: string; expiresAt: Date | null }> {
  const now = new Date()
  const existing = await prisma.estimateApprovalToken.findFirst({
    where: {
      tenantId: params.tenantId,
      estimateId: params.estimateId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: 'desc' },
    select: { tokenEnc: true, expiresAt: true },
  })

  if (existing?.tokenEnc) {
    const rawToken = decryptToken(existing.tokenEnc)
    return { rawToken, url: buildPublicApproveEstimateUrl(rawToken), expiresAt: existing.expiresAt || null }
  }

  const rawToken = crypto.randomBytes(APPROVAL_TOKEN_BYTES).toString('hex')
  const tokenHash = hashApprovalToken(rawToken)
  const tokenEnc = encryptToken(rawToken)
  const expiresAt =
    typeof params.expiresInDays === 'number'
      ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

  await prisma.estimateApprovalToken.create({
    data: {
      tenantId: params.tenantId,
      estimateId: params.estimateId,
      tokenHash,
      tokenEnc,
      expiresAt,
    },
  })

  return { rawToken, url: buildPublicApproveEstimateUrl(rawToken), expiresAt }
}

export async function resolveEstimateApprovalToken(rawToken: string) {
  const tokenHash = hashApprovalToken(rawToken)
  const now = new Date()
  const token = await prisma.estimateApprovalToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  })
  return token || null
}

export async function revokeAndRotateEstimateApprovalToken(params: {
  tenantId: string
  estimateId: string
}): Promise<{ rawToken: string; url: string; expiresAt: Date | null }> {
  const now = new Date()
  await prisma.estimateApprovalToken.updateMany({
    where: {
      tenantId: params.tenantId,
      estimateId: params.estimateId,
      revokedAt: null,
    },
    data: { revokedAt: now },
  })
  return getOrCreateEstimateApprovalToken({ tenantId: params.tenantId, estimateId: params.estimateId })
}

