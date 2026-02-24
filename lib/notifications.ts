import crypto from 'crypto'
import { NotificationType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendPushToDevices } from '@/lib/services/mobile-push'

export type CreateNotificationResult = {
  ok: boolean
  notificationId?: string
  traceId?: string
  deliveryStatus?: 'QUEUED' | 'SENT' | 'FAILED'
  reason?: string
}

interface CreateNotificationParams {
  tenantId: string
  userId: string
  type: NotificationType
  title: string
  message?: string | null
  linkUrl?: string | null
  linkType?: string | null
  linkId?: string | null
  requiresAck?: boolean
  actorUserId?: string | null
  dedupeKey?: string | null
  action?: string | null
}

function makeTraceId() {
  return crypto.randomUUID()
}

function makeDedupeKey(params: {
  tenantId: string
  userId: string
  type: NotificationType
  entityId?: string | null
  action?: string | null
}) {
  const bucket = Math.floor(Date.now() / (1000 * 30)) // 30s bucket
  return `${params.tenantId}:${params.userId}:${params.type}:${params.entityId || 'none'}:${params.action || 'update'}:${bucket}`
}

function buildMobileDeepLink(linkType?: string | null, linkId?: string | null): string | undefined {
  if (!linkType || !linkId) return undefined
  if (linkType === 'job') return `trimpro://jobs/${linkId}`
  if (linkType === 'task') return `trimpro://tasks/${linkId}`
  if (linkType === 'issue') return `trimpro://issues/${linkId}`
  if (linkType === 'message' || linkType === 'conversation') return `trimpro://messages/${linkId}`
  return undefined
}

async function shouldCollapseByRateLimit(tenantId: string, userId: string) {
  const oneMinuteAgo = new Date(Date.now() - 60_000)
  const count = await prisma.notification.count({
    where: {
      tenantId,
      userId,
      createdAt: { gte: oneMinuteAgo },
    },
  })
  return count >= 20
}

async function createAndSendNotification(params: CreateNotificationParams): Promise<CreateNotificationResult> {
  const traceId = makeTraceId()
  const deepLink = buildMobileDeepLink(params.linkType, params.linkId)
  const rateLimited = await shouldCollapseByRateLimit(params.tenantId, params.userId)

  const title = rateLimited ? 'You have new updates' : params.title
  const message = rateLimited ? 'Open TrimPro to review your latest updates.' : params.message || null
  const dedupeKey =
    params.dedupeKey ||
    makeDedupeKey({
      tenantId: params.tenantId,
      userId: params.userId,
      type: params.type,
      entityId: params.linkId,
      action: params.action,
    })

  let notification = null as any
  try {
    notification = await prisma.notification.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        type: params.type,
        title,
        message,
        linkUrl: params.linkUrl || null,
        linkType: params.linkType || null,
        linkId: params.linkId || null,
        requiresAck: params.requiresAck || false,
        status: 'UNREAD',
        traceId,
        dedupeKey,
        data: {
          entityType: params.linkType || null,
          entityId: params.linkId || null,
          action: params.action || 'update',
          actorUserId: params.actorUserId || null,
          deepLink,
          timestamp: new Date().toISOString(),
          traceId,
        },
        deliveryStatus: 'QUEUED',
      },
    })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return { ok: true, reason: 'duplicate_event' }
    }
    throw error
  }

  const pushResult = await sendPushToDevices({
    traceId,
    tenantId: params.tenantId,
    recipientUserId: params.userId,
    payload: {
      title,
      body: message || undefined,
      data: {
        notificationId: notification.id,
        linkType: params.linkType || undefined,
        linkId: params.linkId || undefined,
        deepLink,
        traceId,
      },
    },
  })

  const deliveryStatus: 'FAILED' | 'SENT' = pushResult.failed > 0 && pushResult.sent === 0 ? 'FAILED' : 'SENT'
  const failureReason =
    pushResult.failed > 0
      ? `tickets_failed=${pushResult.failed};receipts_failed=${pushResult.receiptErrors.length}`
      : null

  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      deliveryStatus,
      sentAt: new Date(),
      failureReason,
    },
  })

  return {
    ok: true,
    notificationId: notification.id,
    traceId,
    deliveryStatus,
    reason: failureReason || undefined,
  }
}

export async function createNotification(params: CreateNotificationParams): Promise<CreateNotificationResult> {
  try {
    return await createAndSendNotification(params)
  } catch (error) {
    console.error('Failed to create notification:', error)
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'create_notification_failed',
    }
  }
}
export async function createNotificationsForUsers(
  tenantId: string,
  userIds: string[],
  params: Omit<CreateNotificationParams, 'tenantId' | 'userId'>
) {
  const recipients = Array.from(new Set(userIds.filter(Boolean)))
  for (const userId of recipients) {
    await createNotification({
      tenantId,
      userId,
      ...params,
      dedupeKey:
        params.dedupeKey ||
        makeDedupeKey({
          tenantId,
          userId,
          type: params.type,
          entityId: params.linkId,
          action: params.action,
        }),
    })
  }
}

/**
 * Notify dispatch-facing users about job activity (status, notes, media, messages).
 */
export async function notifyDispatchJobActivity(params: {
  tenantId: string
  jobId: string
  title: string
  message?: string | null
  excludeUserId?: string | null
  actorUserId?: string | null
  action?: string | null
}) {
  const dispatchUsers = await prisma.user.findMany({
    where: {
      tenantId: params.tenantId,
      role: { in: ['ADMIN', 'OFFICE', 'ACCOUNTING'] },
      status: 'ACTIVE',
      ...(params.excludeUserId ? { id: { not: params.excludeUserId } } : {}),
    },
    select: { id: true },
  })

  if (dispatchUsers.length === 0) return

  await createNotificationsForUsers(
    params.tenantId,
    dispatchUsers.map((u) => u.id),
    {
      type: 'JOB_UPDATED',
      title: params.title,
      message: params.message || null,
      linkUrl: `/dashboard/dispatch?jobId=${params.jobId}`,
      linkType: 'job',
      linkId: params.jobId,
      actorUserId: params.actorUserId || null,
      action: params.action || 'job_updated',
    }
  )
}

/**
 * Notify when a job is assigned to a tech
 */
export async function notifyJobAssigned(
  tenantId: string,
  techUserId: string,
  jobId: string,
  jobTitle: string
) {
  await createNotification({
    tenantId,
    userId: techUserId,
    type: 'JOB_ASSIGNED',
    title: 'New Job Assigned',
    message: `You have been assigned to job: ${jobTitle}`,
    linkUrl: `/dashboard/jobs/${jobId}`,
    linkType: 'job',
    linkId: jobId,
    action: 'job_assigned',
  })
}

/**
 * Notify when an invoice is paid
 */
export async function notifyInvoicePaid(
  tenantId: string,
  invoiceId: string,
  invoiceNumber: string,
  amount: number,
  clientName: string
) {
  // Notify office/admin/accounting users (anyone watching payments in the web app).
  const accountingUsers = await prisma.user.findMany({
    where: {
      tenantId,
      role: { in: ['ADMIN', 'ACCOUNTING', 'OFFICE'] },
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  if (accountingUsers.length > 0) {
    await createNotificationsForUsers(tenantId, accountingUsers.map((u) => u.id), {
      type: 'PAYMENT_RECEIVED',
      title: 'Payment Received',
      message: `${clientName} paid ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} for invoice ${invoiceNumber}`,
      linkUrl: `/dashboard/invoices/${invoiceId}`,
      linkType: 'invoice',
      linkId: invoiceId,
      requiresAck: true,
    })
  }
}

/**
 * Notify when an invoice is overdue
 */
export async function notifyInvoiceOverdue(
  tenantId: string,
  invoiceId: string,
  invoiceNumber: string,
  clientName: string,
  daysOverdue: number
) {
  // Notify accounting users and admins
  const accountingUsers = await prisma.user.findMany({
    where: {
      tenantId,
      role: { in: ['ADMIN', 'ACCOUNTING', 'OFFICE'] },
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  if (accountingUsers.length > 0) {
    await createNotificationsForUsers(tenantId, accountingUsers.map((u) => u.id), {
      type: 'INVOICE_OVERDUE',
      title: 'Invoice Overdue',
      message: `Invoice ${invoiceNumber} for ${clientName} is ${daysOverdue} days overdue`,
      linkUrl: `/dashboard/invoices/${invoiceId}`,
      linkType: 'invoice',
      linkId: invoiceId,
    })
  }
}

/**
 * Notify when a new lead is created
 */
export async function notifyNewLead(
  tenantId: string,
  leadId: string,
  leadName: string
) {
  // Notify sales users and admins
  const salesUsers = await prisma.user.findMany({
    where: {
      tenantId,
      role: { in: ['ADMIN', 'SALES'] },
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  if (salesUsers.length > 0) {
    await createNotificationsForUsers(tenantId, salesUsers.map((u) => u.id), {
      type: 'OTHER',
      title: 'New Lead Created',
      message: `New lead: ${leadName}`,
      linkUrl: `/dashboard/leads/${leadId}`,
      linkType: 'lead',
      linkId: leadId,
    })
  }
}

/**
 * Notify when a task is assigned
 */
export async function notifyTaskAssigned(
  tenantId: string,
  userId: string,
  taskId: string,
  taskTitle: string
) {
  await createNotification({
    tenantId,
    userId,
    type: 'TASK_ASSIGNED',
    title: 'New Task Assigned',
    message: `You have been assigned a task: ${taskTitle}`,
    linkUrl: `/dashboard/tasks/${taskId}`,
    linkType: 'task',
    linkId: taskId,
      action: 'task_assigned',
  })
}

/**
 * Notify when a task is overdue
 */
export async function notifyTaskOverdue(
  tenantId: string,
  userId: string,
  taskId: string,
  taskTitle: string
) {
  await createNotification({
    tenantId,
    userId,
    type: 'TASK_OVERDUE',
    title: 'Task Overdue',
    message: `Task "${taskTitle}" is overdue`,
    linkUrl: `/dashboard/tasks/${taskId}`,
    linkType: 'task',
    linkId: taskId,
  })
}

/**
 * Notify when an issue is assigned
 */
export async function notifyIssueAssigned(
  tenantId: string,
  userId: string,
  issueId: string,
  issueTitle: string
) {
  await createNotification({
    tenantId,
    userId,
    type: 'ISSUE_ASSIGNED',
    title: 'Issue Assigned',
    message: `You have been assigned an issue: ${issueTitle}`,
    linkUrl: `/dashboard/issues/${issueId}`,
    linkType: 'issue',
    linkId: issueId,
    action: 'issue_assigned',
  })
}
