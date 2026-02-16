import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: params.id },
      include: {
        estimate: { select: { tenantId: true } },
        invoice: { select: { tenantId: true } },
        job: { select: { tenantId: true } },
      },
    })

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    const tenantId =
      attachment.estimate?.tenantId ||
      attachment.invoice?.tenantId ||
      attachment.job?.tenantId ||
      null

    if (!tenantId || tenantId !== user.tenantId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.attachment.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Delete attachment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
