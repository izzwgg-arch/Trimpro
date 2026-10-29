import { NotificationType } from '@prisma/client'

export type NotificationPreferenceKey =
  | 'emailNotifications'
  | 'newJobAssigned'
  | 'jobStatusChanges'
  | 'requestStatusChanges'
  | 'newMessage'
  | 'paymentReceived'
  | 'taskAssigned'
  | 'taskUpdated'
  | 'taskOverdue'
  | 'issueAssigned'
  | 'issueUpdated'
  | 'attachmentUploaded'
  | 'scheduleReminder'
  | 'invoiceOverdue'
  | 'incomingCall'
  | 'incomingSms'

export type UserNotificationPreferences = Record<NotificationPreferenceKey, boolean>

/** One row per preference, in display order. Shared by the web + mobile settings UI. */
export const NOTIFICATION_PREFERENCE_META: Array<{
  key: NotificationPreferenceKey
  title: string
  description: string
  /** false by default (everything else defaults on). */
  defaultOff?: boolean
}> = [
  { key: 'emailNotifications', title: 'Email notifications', description: 'Also send alerts to your account email (off by default).', defaultOff: true },
  { key: 'newJobAssigned', title: 'New job assigned', description: 'When a job is assigned to you.' },
  { key: 'jobStatusChanges', title: 'Job updates', description: 'When a job you are on changes status or schedule.' },
  { key: 'requestStatusChanges', title: 'Request updates', description: 'When a request you created or are assigned to changes.' },
  { key: 'newMessage', title: 'New messages', description: 'When you receive a chat or job message.' },
  { key: 'paymentReceived', title: 'Payment alerts', description: 'When a payment is received.' },
  { key: 'taskAssigned', title: 'Task assigned', description: 'When a task is assigned to you.' },
  { key: 'taskUpdated', title: 'Task updates', description: 'When a task you are on changes.' },
  { key: 'taskOverdue', title: 'Task overdue', description: 'When one of your tasks becomes overdue.' },
  { key: 'issueAssigned', title: 'Issue assigned', description: 'When an issue is assigned to you.' },
  { key: 'issueUpdated', title: 'Issue updates', description: 'When an issue you are on changes.' },
  { key: 'attachmentUploaded', title: 'Attachment uploaded', description: 'When a photo or file is added to a job you are on.' },
  { key: 'scheduleReminder', title: 'Schedule reminders', description: 'Reminders for your upcoming scheduled visits.' },
  { key: 'invoiceOverdue', title: 'Invoice overdue', description: 'When an invoice becomes overdue.' },
  { key: 'incomingCall', title: 'Incoming calls', description: 'When a call comes in for you.' },
  { key: 'incomingSms', title: 'Incoming texts', description: 'When a text message comes in for you.' },
]

export const NOTIFICATION_PREFERENCE_KEYS: NotificationPreferenceKey[] = NOTIFICATION_PREFERENCE_META.map((m) => m.key)

export const DEFAULT_NOTIFICATION_PREFERENCES: UserNotificationPreferences = NOTIFICATION_PREFERENCE_META.reduce(
  (acc, m) => {
    acc[m.key] = !m.defaultOff
    return acc
  },
  {} as UserNotificationPreferences
)

export function normalizeNotificationPreferences(raw: unknown): UserNotificationPreferences {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out = {} as UserNotificationPreferences
  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    out[key] = typeof source[key] === 'boolean' ? (source[key] as boolean) : DEFAULT_NOTIFICATION_PREFERENCES[key]
  }
  return out
}

/**
 * The preference that gates a given notification, or null when the notification
 * is always delivered (SYSTEM, generic OTHER, …). `emailNotifications` is a
 * channel toggle, never returned here.
 */
export function preferenceKeyForNotification(
  type: NotificationType,
  linkType?: string | null
): Exclude<NotificationPreferenceKey, 'emailNotifications'> | null {
  switch (type) {
    case 'MESSAGE_RECEIVED':
      return 'newMessage'
    case 'JOB_ASSIGNED':
      return 'newJobAssigned'
    case 'JOB_UPDATED':
      return 'jobStatusChanges'
    case 'PAYMENT_RECEIVED':
      return 'paymentReceived'
    case 'TASK_ASSIGNED':
      return 'taskAssigned'
    case 'TASK_UPDATED':
      return 'taskUpdated'
    case 'TASK_OVERDUE':
      return 'taskOverdue'
    case 'ISSUE_ASSIGNED':
      return 'issueAssigned'
    case 'ISSUE_UPDATED':
      return 'issueUpdated'
    case 'JOB_MEDIA_ADDED':
      return 'attachmentUploaded'
    case 'SCHEDULE_REMINDER':
      return 'scheduleReminder'
    case 'INVOICE_OVERDUE':
      return 'invoiceOverdue'
    case 'INCOMING_CALL':
      return 'incomingCall'
    case 'INCOMING_SMS':
      return 'incomingSms'
    case 'OTHER':
      if (linkType === 'request' || linkType === 'lead') return 'requestStatusChanges'
      return null
    default:
      return null
  }
}
