/**
 * Notification Service
 * Creates notifications for key events in the system
 */

import { prisma } from '@/lib/prisma'
import { NotificationType } from '@prisma/client'

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
}

/**
 * Create a notification for a user
 */
export async function createNotification(params: CreateNotificationParams) {
  try {
    await prisma.notification.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message || null,
        linkUrl: params.linkUrl || null,
        linkType: params.linkType || null,
        linkId: params.linkId || null,
        requiresAck: params.requiresAck || false,
        status: 'UNREAD',
      },
    })
  } catch (error) {
    console.error('Failed to create notification:', error)
    // Don't throw - notifications are non-critical
  }
}

/**
 * Create notifications for multiple users
 */
export async function createNotificationsForUsers(
  tenantId: string,
  userIds: string[],
  params: Omit<CreateNotificationParams, 'tenantId' | 'userId'>
) {
  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        tenantId,
        userId,
        type: params.type,
        title: params.title,
        message: params.message || null,
        linkUrl: params.linkUrl || null,
        linkType: params.linkType || null,
        linkId: params.linkId || null,
        requiresAck: params.requiresAck || false,
        status: 'UNREAD',
      })),
    })
  } catch (error) {
    console.error('Failed to create notifications:', error)
    // Don't throw - notifications are non-critical
  }
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
    type: 'TASK_ASSIGNED',
    title: 'New Job Assigned',
    message: `You have been assigned to job: ${jobTitle}`,
    linkUrl: `/dashboard/jobs/${jobId}`,
    linkType: 'job',
    linkId: jobId,
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
  // Notify accounting users and admins
  const accountingUsers = await prisma.user.findMany({
    where: {
      tenantId,
      role: { in: ['ADMIN', 'ACCOUNTING'] },
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
      role: { in: ['ADMIN', 'ACCOUNTING'] },
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
  })
}
