import { sendEmail } from '@/lib/email/provider'
import { getEmailBranding } from '@/lib/email/branding'
import { buildStaffNotificationEmail } from '@/lib/email/templates/staff-notification'
import { getPublicBaseUrl } from '@/lib/public-url'

function absoluteActionUrl(linkUrl?: string | null): string | null {
  const raw = String(linkUrl || '').trim()
  if (!raw) return `${getPublicBaseUrl()}/dashboard`
  if (/^https?:\/\//i.test(raw)) return raw
  const path = raw.startsWith('/') ? raw : `/${raw}`
  return `${getPublicBaseUrl()}${path}`
}

export async function sendStaffNotificationEmail(params: {
  tenantId: string
  to: string
  recipientName?: string | null
  title: string
  message?: string | null
  linkUrl?: string | null
  notificationId?: string
}): Promise<{ sent: boolean; error?: string }> {
  const email = String(params.to || '').trim()
  if (!email) return { sent: false, error: 'missing_email' }

  try {
    const branding = await getEmailBranding(params.tenantId).catch(() => null)
    const built = buildStaffNotificationEmail({
      recipientName: params.recipientName,
      title: params.title,
      message: params.message,
      actionUrl: absoluteActionUrl(params.linkUrl),
      companyName:
        (branding as any)?.invoiceBusinessName ||
        (branding as any)?.emailFromName ||
        'TrimPro',
      logoUrl:
        (branding as any)?.emailLogoUrl ||
        (branding as any)?.webLogoUrl ||
        null,
    })

    const result = await sendEmail({
      to: email,
      subject: built.subject,
      html: built.html,
      text: built.text,
      skipGlobalCc: true,
      metadata: {
        emailType: 'staff_notification',
        notificationId: params.notificationId || null,
        sendSource: 'lib/notifications/email',
      },
    })

    if (!result.success) {
      return { sent: false, error: result.error || 'send_failed' }
    }
    return { sent: true }
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : 'send_failed',
    }
  }
}
