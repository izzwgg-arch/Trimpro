import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/server'
import { prisma } from '@/lib/db'
import { quickBooksService } from '@/lib/services/quickbooks'

function buildLineRows(qboEstimate: any) {
  const qboLines = Array.isArray(qboEstimate?.Line) ? qboEstimate.Line : []
  let detectedDiscount = 0
  let runningSinceLastSubtotal = 0

  const lineRows = qboLines
    .filter((line: any) => line && typeof line === 'object')
    .flatMap((line: any, idx: number) => {
      const detailType = String(line.DetailType || '')
      const amount = Number(line.Amount || 0)

      if (detailType === 'DiscountLineDetail') {
        detectedDiscount += Math.abs(amount)
        return []
      }

      if (detailType === 'SubTotalLineDetail') {
        const subtotalAmt = amount > 0 ? amount : runningSinceLastSubtotal
        runningSinceLastSubtotal = 0
        return [
          {
            description: 'Subtotal',
            notes: null,
            quantity: 0,
            unitPrice: 0,
            total: subtotalAmt,
            sortOrder: idx,
            taxable: false,
            isSubtotal: true,
          },
        ]
      }

      if (detailType === 'DescriptionOnly') return []
      if (!amount) return []

      const qty = Number(line?.SalesItemLineDetail?.Qty) || 1
      const unitPrice = Number(line?.SalesItemLineDetail?.UnitPrice) || (qty ? amount / qty : amount)
      const itemName =
        String(line?.SalesItemLineDetail?.ItemRef?.name || '') ||
        String(line?.SalesItemLineDetail?.ItemRef?.value || '') ||
        ''
      const description = String(line.Description || '')
      const finalDescription = (itemName || description || `Line ${idx + 1}`).slice(0, 500)
      const finalNotes =
        description && itemName && description !== itemName ? description.slice(0, 2000) : null

      runningSinceLastSubtotal += amount

      return [
        {
          description: finalDescription,
          notes: finalNotes,
          quantity: qty,
          unitPrice,
          total: amount,
          sortOrder: idx,
          taxable: true,
          isSubtotal: false,
        },
      ]
    })

  return { lineRows, detectedDiscount }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authenticateRequest(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const estimateId = params.id
    const estimate = await prisma.estimate.findFirst({
      where: { id: estimateId, tenantId: user.tenantId },
      select: { id: true, tenantId: true },
    })
    if (!estimate) return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })

    // Find the QBO mapping for this estimate
    const syncLog = await prisma.quickBooksSyncLog.findFirst({
      where: {
        entityId: estimateId,
        type: 'estimate',
        status: { in: ['success', 'conflict'] },
      },
      orderBy: { id: 'desc' },
      select: { qboId: true, integrationId: true },
    })

    if (!syncLog?.qboId) {
      return NextResponse.json(
        { error: 'This estimate was not imported from QuickBooks, or no QBO mapping was found.' },
        { status: 400 }
      )
    }

    // Get QBO session
    const integration = await prisma.integration.findFirst({
      where: { id: syncLog.integrationId, tenantId: user.tenantId },
      select: { id: true, accessToken: true, realmId: true },
    })
    if (!integration?.accessToken || !integration?.realmId) {
      return NextResponse.json(
        { error: 'QuickBooks is not connected. Reconnect QuickBooks and try again.' },
        { status: 503 }
      )
    }

    // Fetch fresh estimate from QBO
    const qboResponse = await quickBooksService.makeAPIRequest(
      integration.accessToken,
      integration.realmId,
      `/estimate/${encodeURIComponent(syncLog.qboId)}`,
      'GET',
      undefined,
      {
        tenantId: user.tenantId,
        entityType: 'estimate',
        entityId: syncLog.qboId,
        triggerSource: 'reimport_lines',
      }
    )

    const qboEstimate = qboResponse?.Estimate
    if (!qboEstimate?.Id) {
      return NextResponse.json(
        { error: 'QuickBooks estimate not found. It may have been deleted or made inactive.' },
        { status: 404 }
      )
    }

    const { lineRows } = buildLineRows(qboEstimate)

    // Replace all line items
    await prisma.$transaction(async (tx) => {
      await tx.estimateLineItem.deleteMany({ where: { estimateId } })

      if (lineRows.length > 0) {
        await tx.estimateLineItem.createMany({
          data: lineRows.map((line: any) => ({
            estimateId,
            groupId: null,
            sourceItemId: null,
            sourceBundleId: null,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unitCost: null,
            total: line.total,
            sortOrder: line.sortOrder,
            isVisibleToClient: true,
            showDescriptionToCustomer: true,
            showCostToCustomer: false,
            showPriceToCustomer: true,
            showTaxToCustomer: true,
            showNotesToCustomer: false,
            notes: line.notes,
            vendorId: null,
            taxable: line.taxable,
            taxRate: null,
            isSubtotal: line.isSubtotal === true,
          })),
        })
      }
    })

    const subtotalRows = lineRows.filter((l: any) => l.isSubtotal)
    const regularRows = lineRows.filter((l: any) => !l.isSubtotal)

    return NextResponse.json({
      success: true,
      linesImported: lineRows.length,
      subtotalRowsAdded: subtotalRows.length,
      regularItemCount: regularRows.length,
    })
  } catch (err: any) {
    console.error('Reimport estimate lines error:', err)
    return NextResponse.json({ error: err?.message || 'Failed to re-import line items.' }, { status: 500 })
  }
}
