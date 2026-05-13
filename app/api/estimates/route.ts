import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { enqueueQboSync } from '@/lib/qbo/sync-queue'
import { calculateOrderedSubtotalRows } from '@/lib/documents/subtotals'
import { calculateEstimateConversionSummary } from '@/lib/documents/conversion'
import {
  allocateNextEstimateNumber,
  assertEstimateNumberAvailableInQuickBooks,
  normalizeEstimateNumber,
} from '@/lib/qbo/doc-numbers'

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const clientId = searchParams.get('clientId') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const skip = (page - 1) * limit
  const sortByRaw = searchParams.get('sortBy') || 'createdAt'
  const sortDirectionRaw = searchParams.get('sortDirection') || 'desc'
  const sortDirection = sortDirectionRaw === 'asc' ? 'asc' : 'desc'
  const sortMap: Record<string, any> = {
    estimate: [{ estimateNumber: sortDirection }, { title: sortDirection }],
    status: { status: sortDirection },
    client: { client: { name: sortDirection } },
    total: { total: sortDirection },
    createdAt: { createdAt: sortDirection },
  }
  const orderBy = sortMap[sortByRaw] || sortMap.createdAt

  try {
    const where: any = {
      tenantId: user.tenantId,
    }

    if (search) {
      where.OR = [
        { estimateNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status !== 'all') {
      where.status = status
    }

    if (clientId) {
      where.clientId = clientId
    }

    const [estimates, total] = await Promise.all([
      prisma.estimate.findMany({
        where,
        include: {
          client: {
            select: {
              id: true,
              name: true,
              companyName: true,
            },
          },
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          job: {
            select: {
              id: true,
              jobNumber: true,
            },
          },
          _count: {
            select: {
              lineItems: true,
            },
          },
          invoices: {
            where: {
              status: { notIn: ['CANCELLED', 'REFUNDED'] },
            },
            select: {
              total: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.estimate.count({ where }),
    ])

    return NextResponse.json({
      estimates: estimates.map((estimate) => {
        const conversion = calculateEstimateConversionSummary(
          estimate.total,
          estimate.invoices.map((invoice) => invoice.total)
        )
        const { invoices, ...rest } = estimate
        return {
          ...rest,
          convertedPercent: conversion.convertedPercent > 0 ? conversion.convertedPercent : null,
        }
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Get estimates error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const body = await request.json()
    const {
      clientId,
      leadId,
      jobId,
      estimateNumber: estimateNumberOverride,
      title,
      jobSiteAddress,
      lineItems,
      optionalItems,
      groups, // Array of { groupId, name, sourceBundleId }
      taxRate,
      discount,
      validUntil,
      notes,
      isNotesVisibleToClient,
      terms,
    } = body

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    // Calculate totals
    const effectiveLineItems = Array.isArray(lineItems) ? lineItems : []
    const subtotal = effectiveLineItems.reduce((sum: number, item: any) => {
      const qty = parseFloat(item.quantity || 0)
      const price = parseFloat(item.unitPrice || 0)
      return sum + (qty * price)
    }, 0)

    const discountAmount = discount ? parseFloat(discount) : 0
    const subtotalAfterDiscount = subtotal - discountAmount
    const tax = taxRate ? (subtotalAfterDiscount * parseFloat(taxRate)) : 0
    const total = subtotalAfterDiscount + tax

    const estimateNumberOverrideTrimmed = normalizeEstimateNumber(estimateNumberOverride)

    const baseEstimateData = {
      tenantId: user.tenantId,
      clientId: clientId || null,
      leadId: leadId || null,
      jobId: jobId || null,
      title,
      jobSiteAddress: jobSiteAddress || null,
      status: 'DRAFT' as const,
      subtotal: subtotal,
      taxRate: taxRate ? parseFloat(taxRate) : 0,
      taxAmount: tax,
      discount: discountAmount,
      total: total,
      validUntil: validUntil ? new Date(validUntil) : null,
      notes: notes || null,
      isNotesVisibleToClient: isNotesVisibleToClient !== undefined ? Boolean(isNotesVisibleToClient) : true,
      terms: terms || null,
      createdById: user.id,
    }

    let estimate: any = null
    let estimateNumber = ''

    if (estimateNumberOverrideTrimmed) {
      estimateNumber = estimateNumberOverrideTrimmed
      try {
        await assertEstimateNumberAvailableInQuickBooks(user.tenantId, estimateNumber)
      } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Estimate number already exists in QuickBooks' }, { status: 400 })
      }
      try {
        estimate = await prisma.estimate.create({
          data: { ...baseEstimateData, estimateNumber },
          include: { client: true, lead: true },
        })
      } catch (err: any) {
        if (err?.code === 'P2002' && err?.meta?.target?.includes?.('estimateNumber')) {
          return NextResponse.json({ error: 'Estimate number already exists' }, { status: 400 })
        }
        throw err
      }
    } else {
      // Generate estimate number with local + QuickBooks collision-safe retry.
      for (let attempt = 0; attempt < 300; attempt++) {
        estimateNumber = await allocateNextEstimateNumber({ tenantId: user.tenantId })

        try {
          estimate = await prisma.estimate.create({
            data: { ...baseEstimateData, estimateNumber },
            include: { client: true, lead: true },
          })
          break
        } catch (err: any) {
          if (err?.code === 'P2002' && err?.meta?.target?.includes?.('estimateNumber')) {
            continue
          }
          throw err
        }
      }
    }
    if (!estimate) {
      return NextResponse.json({ error: 'Unable to allocate a new estimate number. Please retry.' }, { status: 409 })
    }

    // Create document line groups first (for bundles)
    const groupMap = new Map<string, string>() // groupId -> database group ID
    if (groups && Array.isArray(groups)) {
      for (const group of groups) {
        const dbGroup = await prisma.documentLineGroup.create({
          data: {
            tenantId: user.tenantId,
            documentType: 'ESTIMATE',
            documentId: estimate.id,
            name: group.name || 'Bundle',
            sourceBundleId: group.sourceBundleId || null,
            sourceBundleName: group.name || null,
          },
        })
        groupMap.set(group.groupId, dbGroup.id)
      }
    }

    // Create line items (draft estimates may be created with no items)
    const calculatedLineItems = calculateOrderedSubtotalRows(effectiveLineItems as any[])
    for (let i = 0; i < calculatedLineItems.length; i++) {
      const item = calculatedLineItems[i]
      const isSubtotal = Boolean(item.isSubtotal)
      const itemTotal = item.calculatedSubtotalTotal

      const qty = isSubtotal ? 0 : parseFloat(item.quantity || 0)
      const price = isSubtotal ? 0 : parseFloat(item.unitPrice || 0)

      // Get groupId from map if item has a groupId
      const dbGroupId = item.groupId ? groupMap.get(item.groupId) || null : null

      await prisma.estimateLineItem.create({
        data: {
          estimateId: estimate.id,
          groupId: dbGroupId,
          description: item.description || 'Subtotal',
          quantity: qty,
          unitPrice: price,
          unitCost: item.unitCost ? parseFloat(item.unitCost) : null,
          total: itemTotal,
          sortOrder: i,
          isVisibleToClient: item.isVisibleToClient !== undefined ? Boolean(item.isVisibleToClient) : true,
          showDescriptionToCustomer:
            item.showDescriptionToCustomer !== undefined ? Boolean(item.showDescriptionToCustomer) : true,
          showCostToCustomer: item.showCostToCustomer !== undefined ? Boolean(item.showCostToCustomer) : false,
          showPriceToCustomer: item.showPriceToCustomer !== undefined ? Boolean(item.showPriceToCustomer) : true,
          showTaxToCustomer: item.showTaxToCustomer !== undefined ? Boolean(item.showTaxToCustomer) : true,
          showNotesToCustomer: item.showNotesToCustomer !== undefined ? Boolean(item.showNotesToCustomer) : false,
          vendorId: item.vendorId || null,
          taxable: isSubtotal ? false : (item.taxable !== undefined ? Boolean(item.taxable) : true),
          taxRate: item.taxRate ? parseFloat(item.taxRate) : null,
          notes: item.notes || null,
          sourceItemId: item.sourceItemId || null,
          sourceBundleId: item.sourceBundleId || null,
          isSubtotal,
        },
      })
    }

    // Create optional line items (do NOT affect main totals)
    if (optionalItems && Array.isArray(optionalItems) && optionalItems.length > 0) {
      for (let i = 0; i < optionalItems.length; i++) {
        const item = optionalItems[i]
        const qty = parseFloat(item.quantity || 0)
        const price = parseFloat(item.unitPrice || 0)
        const itemTotal = qty * price

        const dbGroupId = item.groupId ? groupMap.get(item.groupId) || null : null

        await prisma.estimateOptionalLineItem.create({
          data: {
            estimateId: estimate.id,
            groupId: dbGroupId,
            description: item.description,
            quantity: qty,
            unitPrice: price,
            unitCost: item.unitCost ? parseFloat(item.unitCost) : null,
            total: itemTotal,
            sortOrder: i,
            isVisibleToClient: item.isVisibleToClient !== undefined ? Boolean(item.isVisibleToClient) : true,
            showDescriptionToCustomer:
              item.showDescriptionToCustomer !== undefined ? Boolean(item.showDescriptionToCustomer) : true,
            showCostToCustomer: item.showCostToCustomer !== undefined ? Boolean(item.showCostToCustomer) : false,
            showPriceToCustomer: item.showPriceToCustomer !== undefined ? Boolean(item.showPriceToCustomer) : true,
            showTaxToCustomer: item.showTaxToCustomer !== undefined ? Boolean(item.showTaxToCustomer) : true,
            showNotesToCustomer: item.showNotesToCustomer !== undefined ? Boolean(item.showNotesToCustomer) : false,
            vendorId: item.vendorId || null,
            taxable: item.taxable !== undefined ? Boolean(item.taxable) : true,
            taxRate: item.taxRate ? parseFloat(item.taxRate) : null,
            notes: item.notes || null,
            sourceItemId: item.sourceItemId || null,
            sourceBundleId: item.sourceBundleId || null,
          },
        })
      }
    }

    // If estimate is created from a request (lead), convert the request
    if (leadId) {
      const lead = await prisma.lead.findFirst({
        where: {
          id: leadId,
          tenantId: user.tenantId,
        },
      })
      if (lead && lead.status !== 'CONVERTED') {
        await prisma.lead.update({
          where: { id: leadId },
          data: { status: 'ESTIMATE_SENT' },
        })
      }
    }

    // Create activity
    await prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'ESTIMATE_SENT',
        description: `Estimate "${title}" created`,
        estimateId: estimate.id,
        clientId: estimate.clientId || undefined,
        leadId: estimate.leadId || undefined,
      },
    })

    try {
      await enqueueQboSync(user.tenantId, 'estimate', estimate.id)
    } catch (error) {
      console.error('QuickBooks estimate sync trigger error:', error)
    }

    return NextResponse.json({ estimate }, { status: 201 })
  } catch (error) {
    console.error('Create estimate error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
