import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { rateLimitOrThrow } from '@/lib/security/rate-limit'
import { hashApprovalToken } from '@/lib/estimate-approval'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  token: z.string().trim().min(20),
})

const bodySchema = z.object({
  approveAll: z.boolean().optional(),
  selectedLineItemIds: z.array(z.string().trim().min(1)).optional(),
  signerName: z.string().trim().min(2, 'Signer name is required'),
  signerEmail: z.string().trim().email().optional(),
  eSign: z.boolean().optional(),
})

export async function POST(request: NextRequest, ctx: { params: { token: string } }) {
  try {
    rateLimitOrThrow(request, { key: 'public-estimate-approval:approve', limit: 20, windowMs: 60_000 })

    const parsedParams = paramsSchema.safeParse(ctx.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    // Some clients/proxies can cause NextRequest.json() to throw even when content-type is set.
    // Fall back to parsing raw text so "Approve" never silently fails.
    let bodyJson: any = null
    try {
      bodyJson = await request.json()
    } catch {
      const raw = await request.text().catch(() => '')
      try {
        bodyJson = raw ? JSON.parse(raw) : null
      } catch {
        bodyJson = null
      }
    }
    const parsedBody = bodySchema.safeParse(bodyJson)
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 })
    }

    if (parsedBody.data.eSign === false) {
      return NextResponse.json({ error: 'You must confirm you approve this estimate.' }, { status: 400 })
    }

    const tokenHash = hashApprovalToken(parsedParams.data.token)
    const now = new Date()
    const tokenRow = await prisma.estimateApprovalToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { tenantId: true, estimateId: true },
    })
    if (!tokenRow) {
      return NextResponse.json({ error: 'Approval link is invalid or expired.' }, { status: 404 })
    }

    const estimate = await prisma.estimate.findFirst({
      where: { id: tokenRow.estimateId, tenantId: tokenRow.tenantId },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    const visibleLineItemIds = estimate.lineItems
      .filter((li) => li.isVisibleToClient !== false)
      .map((li) => li.id)

    const approveAll = Boolean(parsedBody.data.approveAll)
    const selected = approveAll ? visibleLineItemIds : parsedBody.data.selectedLineItemIds || []
    const normalizedSelected = Array.from(new Set(selected.map((s) => String(s).trim()).filter(Boolean)))

    if (normalizedSelected.length === 0) {
      return NextResponse.json({ error: 'Select at least one item to approve.' }, { status: 400 })
    }

    const visibleSet = new Set(visibleLineItemIds)
    const invalid = normalizedSelected.filter((id) => !visibleSet.has(id))
    if (invalid.length) {
      return NextResponse.json({ error: 'Invalid line item selection.' }, { status: 400 })
    }

    const approvedIds: string[] = []

    await prisma.$transaction(async (tx) => {
      for (const estimateLineItemId of normalizedSelected) {
        const existing = await tx.estimateItemApproval.findUnique({
          where: {
            tenantId_estimateId_estimateLineItemId: {
              tenantId: tokenRow.tenantId,
              estimateId: estimate.id,
              estimateLineItemId,
            },
          },
        })

        if (existing && existing.status === 'APPROVED') {
          approvedIds.push(estimateLineItemId)
          continue
        }

        await tx.estimateItemApproval.upsert({
          where: {
            tenantId_estimateId_estimateLineItemId: {
              tenantId: tokenRow.tenantId,
              estimateId: estimate.id,
              estimateLineItemId,
            },
          },
          create: {
            tenantId: tokenRow.tenantId,
            estimateId: estimate.id,
            estimateLineItemId,
            status: 'APPROVED',
            approvedAt: now,
            approvedByName: parsedBody.data.signerName,
            approvedByEmail: parsedBody.data.signerEmail || null,
          },
          update: {
            status: 'APPROVED',
            approvedAt: now,
            revokedAt: null,
            approvedByName: parsedBody.data.signerName,
            approvedByEmail: parsedBody.data.signerEmail || null,
          },
        })

        approvedIds.push(estimateLineItemId)
      }
    })

    return NextResponse.json({
      ok: true,
      approvedCount: approvedIds.length,
      approvedLineItemIds: approvedIds,
    })
  } catch (err: any) {
    if (err instanceof NextResponse) return err
    if (err?.status === 429) return err
    console.error('Public estimate approval POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

