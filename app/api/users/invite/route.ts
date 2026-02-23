import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { generatePasswordResetToken } from '@/lib/auth'
import { getDefaultPermissions } from '@/lib/permissions'
import { getIntegrationSecrets } from '@/lib/integrations/status'
import { testEmailProvider } from '@/lib/integrations/providers/email'

export async function POST(request: NextRequest) {
  // Authenticate
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { email, firstName, lastName, phone, role } = await request.json()

    if (!email || !firstName || !lastName || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Check if user already exists
    const existing = await prisma.user.findFirst({
      where: {
        tenantId: user.tenantId,
        email: email.toLowerCase(),
      },
    })

    if (existing) {
      return NextResponse.json({ error: 'User already exists' }, { status: 400 })
    }

    // Generate password creation token for invite flow
    const inviteToken = generatePasswordResetToken('7d')
    const inviteExp = new Date()
    inviteExp.setDate(inviteExp.getDate() + 7)

    // Get default permissions for role
    const permissions = getDefaultPermissions(role)

    // Create user
    const newUser = await prisma.user.create({
      data: {
        tenantId: user.tenantId,
        email: email.toLowerCase(),
        firstName,
        lastName,
        phone: phone || null,
        role,
        status: 'INVITED',
        passwordResetToken: inviteToken,
        passwordResetExp: inviteExp,
        permissions,
      },
    })

    // Create audit log for user creation
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'CREATE',
        entityType: 'User',
        entityId: newUser.id,
        changes: {
          email,
          firstName,
          lastName,
          role,
        },
      },
    })

    // Send invite email with password creation link and APK download link.
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.trimprony.com'
    const setPasswordUrl = `${appBaseUrl}/auth/reset-password?token=${encodeURIComponent(inviteToken)}`
    const apkDownloadUrl =
      process.env.TRIMPRO_FIELD_APK_URL ||
      process.env.EXPO_ANDROID_APK_URL ||
      'https://expo.dev/artifacts/eas/2E6kirTmBvmAZXB2KAftdy.apk'
    let emailSent = false
    let emailError: string | null = null
    try {
      const { sendInviteEmail, buildInviteEmailHtml } = await import('@/lib/services/email')
      const emailSecrets = await getIntegrationSecrets(user.tenantId, 'email')

      if (emailSecrets) {
        const html = buildInviteEmailHtml(firstName, setPasswordUrl, apkDownloadUrl)
        const subject = 'Welcome to TrimPro - Create Your Password'
        const sendResult = await testEmailProvider(emailSecrets, email, subject, html)
        if (!sendResult.success) {
          emailError = sendResult.error || sendResult.message || 'Failed to send invite email'
        } else {
          emailSent = true
        }
      } else {
        // Fallback to env-based provider when tenant integration is not configured.
        await sendInviteEmail(email, firstName, setPasswordUrl, apkDownloadUrl)
        emailSent = true
      }
    } catch (error: any) {
      console.error('Failed to send invite email:', error)
      emailError = error?.message || 'Invitation email failed to send'
    }

    return NextResponse.json(
      {
        message: emailSent ? 'User invited successfully' : 'User invited, but email send failed',
        emailSent,
        emailError,
        user: {
          id: newUser.id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          role: newUser.role,
          status: newUser.status,
        },
      },
      { status: emailSent ? 200 : 502 }
    )
  } catch (error) {
    console.error('Invite user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
