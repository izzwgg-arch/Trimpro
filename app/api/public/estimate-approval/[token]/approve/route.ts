import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { rateLimitOrThrow } from '@/lib/security/rate-limit'
import { hashApprovalToken } from '@/lib/estimate-approval'
import { createNotificationsForUsers } from '@/lib/notifications'

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

function getAppUrl(): string {
  return (
    String(process.env.NEXT_PUBLIC_APP_URL || '').trim() ||
    'https://app.trimprony.com'
  ).replace(/\/$/, '')
}

export async function POST(request: NextRequest, ctx: { params: { token: string } }) {
  try {
    rateLimitOrThrow(request, { key: 'public-estimate-approval:approve', limit: 20, windowMs: 60_000 })

    const parsedParams = paramsSchema.safeParse(ctx.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    const rawBody = await request.text().catch(() => '')
    let bodyJson: any = null
    try {
      bodyJson = rawBody ? JSON.parse(rawBody) : null
    } catch {
      bodyJson = null
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
        optionalItems: { orderBy: { sortOrder: 'asc' } },
        client: { select: { name: true, companyName: true } },
      },
    })
    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    const visibleLineItemIds = estimate.lineItems
      .filter((li) => li.isVisibleToClient !== false)
      .map((li) => li.id)

    const visibleOptionalItemIds = (estimate.optionalItems || [])
      .filter((li) => li.isVisibleToClient !== false)
      .map((li) => li.id)

    const allVisibleIds = [...visibleLineItemIds, ...visibleOptionalItemIds]

    const approveAll = Boolean(parsedBody.data.approveAll)
    const selected = approveAll ? allVisibleIds : parsedBody.data.selectedLineItemIds || []
    const normalizedSelected = Array.from(new Set(selected.map((s) => String(s).trim()).filter(Boolean)))

    if (normalizedSelected.length === 0) {
      return NextResponse.json({ error: 'Select at least one item to approve.' }, { status: 400 })
    }

    const visibleSet = new Set(allVisibleIds)
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

    // --- Auto-create job + 50% invoice on first approval ---
    let autoCreatedJob: any = null
    let autoCreatedInvoice: any = null
    let paymentUrl: string | null = null

    if (approvedIds.length > 0 && estimate.clientId) {
      // Auto-create job if not already linked
      try {
        if (!estimate.jobId) {
          autoCreatedJob = await prisma.$transaction(async (tx) => {
            const jobCount = await tx.job.count({ where: { tenantId: tokenRow.tenantId } })
            const jobNumber = `JOB-${String(jobCount + 1).padStart(6, '0')}`
            const job = await tx.job.create({
              data: {
                tenantId: tokenRow.tenantId,
                clientId: estimate.clientId!,
                jobNumber,
                title: estimate.title,
                description: estimate.notes || null,
                status: 'QUOTE',
                priority: 3,
                estimateAmount: estimate.total,
              },
            })

            const addr = estimate.jobSiteAddress ? String(estimate.jobSiteAddress).trim() : null
            if (addr) {
              const parts = addr.split(',').map((p: string) => p.trim()).filter(Boolean)
              const street = parts[0] || addr
              const city = parts[1] || ''
              const stateZip = parts[2] || ''
              const m = stateZip.match(/^([A-Za-z]{2})\s+(.+)$/)
              await tx.address.create({
                data: {
                  jobId: job.id,
                  type: 'job_site',
                  street,
                  city,
                  state: m ? m[1] : stateZip,
                  zipCode: m ? m[2] : '',
                  country: 'US',
                },
              })
            }

            await tx.estimate.update({
              where: { id: estimate.id },
              data: { jobId: job.id },
            })

            return job
          })
        }
      } catch (jobErr) {
        console.error('Failed to auto-create job from approval:', jobErr)
      }

      // Auto-create 50% deposit invoice with per-item breakdown
      const approvedIdSet = new Set(approvedIds)
      const approvedRegularItems = estimate.lineItems.filter(
        (li) => li.isVisibleToClient !== false && approvedIdSet.has(li.id)
      )
      const approvedOptionalItems = (estimate.optionalItems || []).filter(
        (li) => li.isVisibleToClient !== false && approvedIdSet.has(li.id)
      )
      const allApprovedItems = [...approvedRegularItems, ...approvedOptionalItems]

      if (allApprovedItems.length > 0) {
        try {
          autoCreatedInvoice = await prisma.$transaction(async (tx) => {
            const latestInvoice = await tx.invoice.findFirst({
              where: { invoiceNumber: { startsWith: 'INV-' } },
              orderBy: { invoiceNumber: 'desc' },
              select: { invoiceNumber: true },
            })
            const latestNum = latestInvoice?.invoiceNumber
              ? parseInt(latestInvoice.invoiceNumber.replace(/^INV-/, ''), 10)
              : 0
            const startNum = Number.isFinite(latestNum) ? latestNum : 0
            const invoiceNumber = `INV-${String(startNum + 1).padStart(6, '0')}`

            // Build per-item line items at 50%
            const lineItemsData = allApprovedItems.map((li, idx) => {
              const fullPrice = Number(li.unitPrice || 0)
              const qty = Number(li.quantity || 1)
              const charged = Math.round(fullPrice * 50) / 100
              const outstanding = Math.round((fullPrice - charged) * 100) / 100
              const lineTotal = Math.round(charged * qty * 100) / 100
              return {
                description: li.description,
                quantity: qty,
                unitPrice: charged,
                total: lineTotal,
                sortOrder: idx,
                isVisibleToClient: true,
                showDescriptionToCustomer: true,
                showCostToCustomer: false,
                showPriceToCustomer: true,
                showTaxToCustomer: true,
                showNotesToCustomer: true,
                notes: `Full price: $${fullPrice.toFixed(2)} | Charged (50%): $${charged.toFixed(2)} | Outstanding: $${outstanding.toFixed(2)}`,
              }
            })

            const subtotal = lineItemsData.reduce((sum, li) => sum + li.total, 0)
            const taxRate = Number(estimate.taxRate || 0)
            const taxAmount = Math.round(subtotal * taxRate * 100) / 100
            const total = Math.round((subtotal + taxAmount) * 100) / 100
            const paymentToken = crypto.randomBytes(32).toString('hex')

            const inv = await tx.invoice.create({
              data: {
                tenantId: tokenRow.tenantId,
                clientId: estimate.clientId!,
                jobId: autoCreatedJob?.id || estimate.jobId || null,
                estimateId: estimate.id,
                invoiceNumber,
                title: `${estimate.title} - 50% Deposit`,
                status: 'SENT',
                subtotal,
                taxRate,
                taxAmount,
                discount: 0,
                total,
                paidAmount: 0,
                balance: total,
                invoiceDate: now,
                paymentToken,
                notes: `50% deposit invoice from approved estimate ${estimate.estimateNumber}. Remaining 50% due upon completion.`,
              },
            })

            for (const lid of lineItemsData) {
              await tx.invoiceLineItem.create({
                data: {
                  invoiceId: inv.id,
                  ...lid,
                },
              })
            }

            // Mark estimate as CONVERTED with 50% billed
            await tx.estimate.update({
              where: { id: estimate.id },
              data: { status: 'CONVERTED', convertedPercent: 50 },
            })

            paymentUrl = `${getAppUrl()}/portal/pay/${inv.id}?token=${paymentToken}`
            return { ...inv, paymentToken }
          })
        } catch (invoiceErr) {
          console.error('Failed to auto-create 50% invoice:', invoiceErr)
        }
      } else {
        // No line items but still mark as converted
        try {
          await prisma.estimate.update({
            where: { id: estimate.id },
            data: { status: 'CONVERTED', convertedPercent: 50 },
          })
        } catch (e) {
          console.error('Failed to mark estimate as converted:', e)
        }
      }
    }

    // Notify admin/accounting/manager users
    if (approvedIds.length > 0) {
      try {
        const notifyUsers = await prisma.user.findMany({
          where: {
            tenantId: tokenRow.tenantId,
            role: { in: ['ADMIN', 'ACCOUNTING', 'MANAGER'] },
            status: 'ACTIVE',
          },
          select: { id: true },
        })
        if (notifyUsers.length > 0) {
          const clientName =
            estimate.client?.companyName || estimate.client?.name || parsedBody.data.signerName
          const extraInfo = [
            autoCreatedJob ? `Job ${autoCreatedJob.jobNumber} created.` : null,
            autoCreatedInvoice ? `50% deposit invoice ${autoCreatedInvoice.invoiceNumber} created.` : null,
          ].filter(Boolean).join(' ')
          await createNotificationsForUsers(
            tokenRow.tenantId,
            notifyUsers.map((u) => u.id),
            {
              type: 'SYSTEM',
              title: 'Estimate Approved',
              message: `${parsedBody.data.signerName} approved estimate ${estimate.estimateNumber} for ${clientName}. ${extraInfo}`.trim(),
              linkUrl: `/dashboard/estimates/${estimate.id}`,
              linkType: 'estimate',
              linkId: estimate.id,
              requiresAck: true,
            }
          )
        }
      } catch (notifyErr) {
        console.error('Failed to send estimate approval notification:', notifyErr)
      }
    }

    return NextResponse.json({
      ok: true,
      approvedCount: approvedIds.length,
      approvedLineItemIds: approvedIds,
      autoCreatedJob: autoCreatedJob ? { id: autoCreatedJob.id, jobNumber: autoCreatedJob.jobNumber } : null,
      autoCreatedInvoice: autoCreatedInvoice ? { id: autoCreatedInvoice.id, invoiceNumber: autoCreatedInvoice.invoiceNumber } : null,
      paymentUrl,
    })
  } catch (err: any) {
    if (err instanceof NextResponse) return err
    if (err?.status === 429) return err
    console.error('Public estimate approval POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
