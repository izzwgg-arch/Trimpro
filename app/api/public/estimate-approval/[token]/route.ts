import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { rateLimitOrThrow } from '@/lib/security/rate-limit'
import { hashApprovalToken } from '@/lib/estimate-approval'
import { calculateOrderedSubtotalRows, mergeApprovedOptionalItemsForSubtotals } from '@/lib/documents/subtotals'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  token: z.string().trim().min(20),
})

export async function GET(request: NextRequest, ctx: { params: { token: string } }) {
  try {
    rateLimitOrThrow(request, { key: 'public-estimate-approval:get', limit: 60, windowMs: 60_000 })

    const parsed = paramsSchema.safeParse(ctx.params)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    const tokenHash = hashApprovalToken(parsed.data.token)
    const now = new Date()
    const tokenRow = await prisma.estimateApprovalToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, tenantId: true, estimateId: true, expiresAt: true },
    })
    if (!tokenRow) {
      return NextResponse.json({ error: 'Approval link is invalid or expired.' }, { status: 404 })
    }

    await prisma.estimateApprovalToken.update({
      where: { id: tokenRow.id },
      data: { lastViewedAt: now },
    })

    const estimate = await prisma.estimate.findFirst({
      where: { id: tokenRow.estimateId, tenantId: tokenRow.tenantId },
      include: {
        client: { select: { id: true, name: true, companyName: true } },
        lineItems: { orderBy: { sortOrder: 'asc' } },
        optionalItems: { orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    const approvals = await prisma.estimateItemApproval.findMany({
      where: {
        tenantId: tokenRow.tenantId,
        estimateId: estimate.id,
      },
      select: {
        estimateLineItemId: true,
        status: true,
        approvedAt: true,
        approvedByName: true,
      },
    })
    const approvedMap = new Map(
      approvals
        .filter((a) => a.status === 'APPROVED')
        .map((a) => [a.estimateLineItemId, a])
    )
    const visibleRegularItems = estimate.lineItems.filter((li) => li.isVisibleToClient !== false)
    const allVisibleOptionalItems = (estimate.optionalItems || []).filter((li) => li.isVisibleToClient !== false)
    const approvedOptionalItems = allVisibleOptionalItems.filter((li) => approvedMap.has(li.id))
    const pendingOptionalItems = allVisibleOptionalItems.filter((li) => !approvedMap.has(li.id))
    const visibleLineItems = calculateOrderedSubtotalRows(
      mergeApprovedOptionalItemsForSubtotals(visibleRegularItems as any[], approvedOptionalItems as any[])
    )

    const sources = await prisma.invoiceLineItemSource.findMany({
      where: {
        tenantId: tokenRow.tenantId,
        estimateId: estimate.id,
      },
      select: { estimateLineItemId: true, invoiceId: true, createdAt: true },
    })
    const invoicedMap = new Map<string, { invoiceId: string; createdAt: Date }>()
    for (const s of sources) {
      if (!invoicedMap.has(s.estimateLineItemId)) {
        invoicedMap.set(s.estimateLineItemId, { invoiceId: s.invoiceId, createdAt: s.createdAt })
      }
    }

    return NextResponse.json({
      estimate: {
        id: estimate.id,
        estimateNumber: estimate.estimateNumber,
        title: estimate.title,
        createdAt: estimate.createdAt,
        jobSiteAddress: estimate.jobSiteAddress,
        client: estimate.client ? { name: estimate.client.companyName || estimate.client.name } : null,
        expiresAt: tokenRow.expiresAt,
      },
      items: visibleLineItems.map((li) => {
        const approved = approvedMap.get(li.id) || null
        const invoiced = invoicedMap.get(li.id) || null
        return {
          id: li.id,
          description: li.showDescriptionToCustomer !== false ? li.description : '',
          notes: li.showNotesToCustomer !== false ? (li.notes || '') : '',
          quantity: String(li.quantity),
          unitPrice: li.showPriceToCustomer !== false ? String(li.unitPrice) : '0',
          unitCost: li.showCostToCustomer === true ? (li.unitCost ? String(li.unitCost) : null) : null,
          total: String(li.isSubtotal ? li.calculatedSubtotalTotal : li.total),
          showPriceToCustomer: li.showPriceToCustomer !== false,
          isOptional: false,
          isSubtotal: (li as any).isSubtotal === true,
          approved: Boolean(approved),
          approvedAt: approved?.approvedAt || null,
          approvedByName: approved?.approvedByName || null,
          invoiced: Boolean(invoiced),
          invoicedAt: invoiced?.createdAt || null,
        }
      }),
      optionalItems: pendingOptionalItems.map((li) => {
        const approved = approvedMap.get(li.id) || null
        const invoiced = invoicedMap.get(li.id) || null
        return {
          id: li.id,
          description: li.showDescriptionToCustomer !== false ? li.description : '',
          notes: li.showNotesToCustomer !== false ? (li.notes || '') : '',
          quantity: String(li.quantity),
          unitPrice: li.showPriceToCustomer !== false ? String(li.unitPrice) : '0',
          unitCost: li.showCostToCustomer === true ? (li.unitCost ? String(li.unitCost) : null) : null,
          total: String(li.total),
          showPriceToCustomer: li.showPriceToCustomer !== false,
          isOptional: true,
          approved: Boolean(approved),
          approvedAt: approved?.approvedAt || null,
          approvedByName: approved?.approvedByName || null,
          invoiced: Boolean(invoiced),
          invoicedAt: invoiced?.createdAt || null,
        }
      }),
    })
  } catch (err: any) {
    if (err instanceof NextResponse) return err
    if (err?.status === 429) return err
    console.error('Public estimate approval GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

