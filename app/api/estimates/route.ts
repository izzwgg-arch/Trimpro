import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { syncEstimateToQuickBooks } from '@/lib/services/qbo-sync'

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
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.estimate.count({ where }),
    ])

    return NextResponse.json({
      estimates,
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
      title,
      jobSiteAddress,
      lineItems,
      groups, // Array of { groupId, name, sourceBundleId }
      taxRate,
      discount,
      validUntil,
      notes,
      isNotesVisibleToClient,
      terms,
    } = body

    if (!title || !lineItems || lineItems.length === 0) {
      return NextResponse.json({ error: 'Title and at least one line item are required' }, { status: 400 })
    }

    // Calculate totals
    const subtotal = lineItems.reduce((sum: number, item: any) => {
      const qty = parseFloat(item.quantity || 0)
      const price = parseFloat(item.unitPrice || 0)
      return sum + (qty * price)
    }, 0)

    const discountAmount = discount ? parseFloat(discount) : 0
    const subtotalAfterDiscount = subtotal - discountAmount
    const tax = taxRate ? (subtotalAfterDiscount * parseFloat(taxRate)) : 0
    const total = subtotalAfterDiscount + tax

    // Generate estimate number with global collision-safe retry.
    let estimate: any = null
    for (let attempt = 0; attempt < 300; attempt++) {
      const latestEstimate = await prisma.estimate.findFirst({
        where: { estimateNumber: { startsWith: 'EST-' } },
        orderBy: { estimateNumber: 'desc' },
        select: { estimateNumber: true },
      })
      const latestNumMatch = latestEstimate?.estimateNumber?.match(/^EST-(\d+)/)
      const latestNum = latestNumMatch ? parseInt(latestNumMatch[1], 10) : 0
      const baseNum = Number.isFinite(latestNum) ? latestNum : 0
      const estimateNumber = `EST-${String(baseNum + 1 + attempt).padStart(6, '0')}`

      try {
        estimate = await prisma.estimate.create({
          data: {
            tenantId: user.tenantId,
            clientId: clientId || null,
            leadId: leadId || null,
            jobId: jobId || null,
            estimateNumber,
            title,
            jobSiteAddress: jobSiteAddress || null,
            status: 'DRAFT',
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
          },
          include: {
            client: true,
            lead: true,
          },
        })
        break
      } catch (err: any) {
        if (err?.code === 'P2002' && err?.meta?.target?.includes?.('estimateNumber')) {
          continue
        }
        throw err
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

    // Create line items
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i]
      const qty = parseFloat(item.quantity || 0)
      const price = parseFloat(item.unitPrice || 0)
      const itemTotal = qty * price

      // Get groupId from map if item has a groupId
      const dbGroupId = item.groupId ? groupMap.get(item.groupId) || null : null

      await prisma.estimateLineItem.create({
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
          // New per-field visibility flags
          showCostToCustomer: item.showCostToCustomer !== undefined ? Boolean(item.showCostToCustomer) : false,
          showPriceToCustomer: item.showPriceToCustomer !== undefined ? Boolean(item.showPriceToCustomer) : true,
          showTaxToCustomer: item.showTaxToCustomer !== undefined ? Boolean(item.showTaxToCustomer) : true,
          showNotesToCustomer: item.showNotesToCustomer !== undefined ? Boolean(item.showNotesToCustomer) : false,
          // Additional fields
          vendorId: item.vendorId || null,
          taxable: item.taxable !== undefined ? Boolean(item.taxable) : true,
          taxRate: item.taxRate ? parseFloat(item.taxRate) : null,
          notes: item.notes || null,
          sourceItemId: item.sourceItemId || null,
          sourceBundleId: item.sourceBundleId || null,
        },
      })
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
      await syncEstimateToQuickBooks(user.tenantId, estimate.id)
    } catch (error) {
      console.error('QuickBooks estimate sync trigger error:', error)
    }

    return NextResponse.json({ estimate }, { status: 201 })
  } catch (error) {
    console.error('Create estimate error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
