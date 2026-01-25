import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { hashPassword, generateTemporaryPassword } from '@/lib/auth'
import { getDefaultPermissions } from '@/lib/permissions'
// import { sendInviteEmail } from '@/lib/email' // TODO: Implement

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

    // Generate temporary password
    const tempPassword = generateTemporaryPassword()
    const tempPasswordHash = await hashPassword(tempPassword)
    const tempPasswordExp = new Date()
    tempPasswordExp.setDate(tempPasswordExp.getDate() + 7) // 7 days expiry

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
        temporaryPassword: tempPasswordHash,
        temporaryPasswordExp: tempPasswordExp,
        permissions,
      },
    })

    // Send invite email with temporary password
    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/login`
    
    try {
      const { sendInviteEmail } = await import('@/lib/services/email')
      await sendInviteEmail(email, firstName, tempPassword, loginUrl)
    } catch (error) {
      console.error('Failed to send invite email:', error)
      // Continue anyway - log for manual use if email fails
      console.log('Invite email:', { email, tempPassword, loginUrl }) // Remove in production
    }

    // Create audit log
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

    return NextResponse.json({
      message: 'User invited successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role,
        status: newUser.status,
      },
    })
  } catch (error) {
    console.error('Invite user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
