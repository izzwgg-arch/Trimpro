import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { requireAnyPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { recordAuditLog, auditContextFromRequest } from '@/lib/audit/log'

// POST logs a view or download of a file/attachment so it shows up in the
// history timeline for the file itself and for the record it belongs to.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireAnyPermission(request, ['jobs.view', 'leads.view', 'clients.view', 'purchase_orders.view', 'invoices.view', 'estimates.view'])
  if (permError) return permError

  const user = getAuthUser(request)
  try {
    const body = await request.json().catch(() => ({}))
    const action = body?.action === 'download' ? 'DOWNLOAD' : 'VIEW'

    const attachment = await prisma.attachment.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        fileName: true,
        clientId: true,
        vendorId: true,
        jobId: true,
        estimateId: true,
        invoiceId: true,
        purchaseOrderId: true,
        taskId: true,
        issueId: true,
        leadId: true,
        emailId: true,
        estimate: { select: { tenantId: true } },
        invoice: { select: { tenantId: true } },
        purchaseOrder: { select: { tenantId: true } },
        job: { select: { tenantId: true } },
        task: { select: { tenantId: true } },
        issue: { select: { tenantId: true } },
        lead: { select: { tenantId: true } },
        client: { select: { tenantId: true } },
        vendor: { select: { tenantId: true } },
      },
    })

    if (!attachment) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const tenantId =
      attachment.estimate?.tenantId ||
      attachment.invoice?.tenantId ||
      attachment.purchaseOrder?.tenantId ||
      attachment.job?.tenantId ||
      attachment.task?.tenantId ||
      attachment.issue?.tenantId ||
      attachment.lead?.tenantId ||
      attachment.client?.tenantId ||
      attachment.vendor?.tenantId ||
      null

    if (!tenantId || tenantId !== user.tenantId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const verb = action === 'DOWNLOAD' ? 'downloaded' : 'viewed'
    // Attach the activity to the parent record so it appears on its history.
    const link: Record<string, string> = {}
    if (attachment.clientId) link.clientId = attachment.clientId
    if (attachment.jobId) link.jobId = attachment.jobId
    if (attachment.estimateId) link.estimateId = attachment.estimateId
    if (attachment.invoiceId) link.invoiceId = attachment.invoiceId
    if (attachment.purchaseOrderId) link.purchaseOrderId = attachment.purchaseOrderId
    if (attachment.taskId) link.taskId = attachment.taskId
    if (attachment.issueId) link.issueId = attachment.issueId
    if (attachment.leadId) link.leadId = attachment.leadId
    if (attachment.emailId) link.emailId = attachment.emailId

    void prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: 'OTHER',
        description: `File "${attachment.fileName}" ${verb}`,
        ...link,
      },
    }).catch(() => {})

    void recordAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action,
      entityType: 'Attachment',
      entityId: attachment.id,
      changes: { fileName: attachment.fileName },
      ...auditContextFromRequest(request),
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Log attachment view error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const permError = await requireAnyPermission(request, ['jobs.view', 'leads.view', 'clients.view', 'purchase_orders.view'])
  if (permError) return permError

  const user = getAuthUser(request)
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: params.id },
      include: {
        estimate: { select: { tenantId: true } },
        invoice: { select: { tenantId: true } },
        purchaseOrder: { select: { tenantId: true } },
        job: { select: { tenantId: true } },
        task: { select: { tenantId: true } },
        issue: { select: { tenantId: true } },
        lead: { select: { tenantId: true } },
      },
    })

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    const tenantId =
      attachment.estimate?.tenantId ||
      attachment.invoice?.tenantId ||
      attachment.purchaseOrder?.tenantId ||
      attachment.job?.tenantId ||
      attachment.task?.tenantId ||
      attachment.issue?.tenantId ||
      attachment.lead?.tenantId ||
      null

    if (!tenantId || tenantId !== user.tenantId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (attachment.leadId) {
      const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      await Promise.all([
        prisma.activity.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            type: 'OTHER',
            description: `REQUEST_ATTACHMENT_REMOVED: ${attachment.fileName}`,
            leadId: attachment.leadId,
          },
        }),
        prisma.auditLog.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            action: 'DELETE',
            entityType: 'RequestAttachment',
            entityId: attachment.id,
            ipAddress,
            userAgent: request.headers.get('user-agent') || undefined,
            changes: {
              requestId: attachment.leadId,
              fileName: attachment.fileName,
              key: attachment.key,
            },
          },
        }),
      ])
    }

    await prisma.attachment.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Delete attachment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
