import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { decryptSecrets, encryptSecrets } from '@/lib/integrations/secrets'
import { isValidEmail } from '@/lib/email'

const saveSchema = z.object({
  fromEmail: z.string().email(),
  fromName: z.string().max(120).optional().or(z.literal('')),
  replyToEmail: z.string().email().optional().or(z.literal('')),
  appPassword: z.string().min(8).max(200).optional(),
  isActive: z.boolean().optional(),
})

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)
  const db = prisma as any

  const profile = await db.userEmailSenderProfile.findUnique({
    where: { userId: user.id },
  })

  if (!profile) {
    return NextResponse.json({
      profile: null,
      fallbackNote: 'System/main email is used when your profile sender is not configured.',
    })
  }

  return NextResponse.json({
    profile: {
      id: profile.id,
      provider: profile.provider,
      status: profile.status,
      fromEmail: profile.fromEmail,
      fromName: profile.fromName,
      replyToEmail: profile.replyToEmail,
      isActive: profile.isActive,
      lastTestedAt: profile.lastTestedAt?.toISOString() || null,
      lastError: profile.lastError,
      hasAppPassword: true,
    },
    fallbackNote: 'System/main email is used when your profile sender is disabled or unavailable.',
  })
}

export async function PUT(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)
  const db = prisma as any

  try {
    const body = await request.json()
    const parsed = saveSchema.parse(body)
    if (parsed.replyToEmail && !isValidEmail(parsed.replyToEmail)) {
      return NextResponse.json({ error: 'Invalid reply-to email' }, { status: 400 })
    }

    const existing = await db.userEmailSenderProfile.findUnique({
      where: { userId: user.id },
    })

    let encryptedCredentials: string
    if (existing) {
      const current = decryptSecrets(existing.encryptedCredentials)
      const appPassword = parsed.appPassword || String(current.appPassword || '')
      if (!appPassword) {
        return NextResponse.json(
          { error: 'App password is required when creating or updating sender profile.' },
          { status: 400 }
        )
      }
      encryptedCredentials = encryptSecrets({ appPassword })
    } else {
      if (!parsed.appPassword) {
        return NextResponse.json({ error: 'App password is required.' }, { status: 400 })
      }
      encryptedCredentials = encryptSecrets({ appPassword: parsed.appPassword })
    }

    const upserted = await db.userEmailSenderProfile.upsert({
      where: { userId: user.id },
      create: {
        tenantId: user.tenantId,
        userId: user.id,
        provider: 'GOOGLE_WORKSPACE',
        status: 'ACTIVE',
        fromEmail: parsed.fromEmail.trim(),
        fromName: parsed.fromName?.trim() || null,
        replyToEmail: parsed.replyToEmail?.trim() || null,
        encryptedCredentials,
        isActive: parsed.isActive ?? true,
      },
      update: {
        status: 'ACTIVE',
        fromEmail: parsed.fromEmail.trim(),
        fromName: parsed.fromName?.trim() || null,
        replyToEmail: parsed.replyToEmail?.trim() || null,
        encryptedCredentials,
        isActive: parsed.isActive ?? existing.isActive,
        lastError: null,
      },
    })

    return NextResponse.json({
      profile: {
        id: upserted.id,
        provider: upserted.provider,
        status: upserted.status,
        fromEmail: upserted.fromEmail,
        fromName: upserted.fromName,
        replyToEmail: upserted.replyToEmail,
        isActive: upserted.isActive,
        lastTestedAt: upserted.lastTestedAt?.toISOString() || null,
        lastError: upserted.lastError,
        hasAppPassword: true,
      },
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('Save user email sender profile error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  const user = getAuthUser(request)
  const db = prisma as any

  await db.userEmailSenderProfile.deleteMany({
    where: { userId: user.id, tenantId: user.tenantId },
  })
  return NextResponse.json({ success: true })
}
