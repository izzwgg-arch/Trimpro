import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'

type EntityType = 'estimate' | 'invoice' | 'job' | 'task' | 'issue'

function isValidEntityType(value: string): value is EntityType {
  return value === 'estimate' || value === 'invoice' || value === 'job' || value === 'task' || value === 'issue'
}

async function ensureEntityAccess(entityType: EntityType, entityId: string, tenantId: string) {
  if (entityType === 'estimate') {
    const estimate = await prisma.estimate.findFirst({ where: { id: entityId, tenantId }, select: { id: true } })
    return Boolean(estimate)
  }
  if (entityType === 'invoice') {
    const invoice = await prisma.invoice.findFirst({ where: { id: entityId, tenantId }, select: { id: true } })
    return Boolean(invoice)
  }
  if (entityType === 'task') {
    const task = await prisma.task.findFirst({ where: { id: entityId, tenantId }, select: { id: true } })
    return Boolean(task)
  }
  if (entityType === 'issue') {
    const issue = await prisma.issue.findFirst({ where: { id: entityId, tenantId }, select: { id: true } })
    return Boolean(issue)
  }
  const job = await prisma.job.findFirst({ where: { id: entityId, tenantId }, select: { id: true } })
  return Boolean(job)
}

export async function GET(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  try {
    const entityTypeRaw = request.nextUrl.searchParams.get('entityType') || ''
    const entityId = request.nextUrl.searchParams.get('entityId') || ''
    if (!isValidEntityType(entityTypeRaw) || !entityId) {
      return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 })
    }

    const hasAccess = await ensureEntityAccess(entityTypeRaw, entityId, user.tenantId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const where =
      entityTypeRaw === 'estimate'
        ? { estimateId: entityId }
        : entityTypeRaw === 'invoice'
          ? { invoiceId: entityId }
          : entityTypeRaw === 'task'
            ? { taskId: entityId }
            : entityTypeRaw === 'issue'
              ? { issueId: entityId }
          : { jobId: entityId }

    const attachments = await prisma.attachment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ attachments })
  } catch (error) {
    console.error('List attachments error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  try {
    const body = await request.json()
    const entityTypeRaw = String(body?.entityType || '')
    const entityId = String(body?.entityId || '')
    const fileName = String(body?.fileName || '')
    const url = String(body?.url || '')
    const mimeType = String(body?.mimeType || 'application/octet-stream')
    const fileSize = Number(body?.fileSize || 0)
    const key = String(body?.key || url)

    if (!isValidEntityType(entityTypeRaw) || !entityId || !fileName || !url || !key || !fileSize) {
      return NextResponse.json({ error: 'Missing required attachment fields' }, { status: 400 })
    }

    const hasAccess = await ensureEntityAccess(entityTypeRaw, entityId, user.tenantId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const data =
      entityTypeRaw === 'estimate'
        ? { estimateId: entityId }
        : entityTypeRaw === 'invoice'
          ? { invoiceId: entityId }
          : entityTypeRaw === 'task'
            ? { taskId: entityId }
            : entityTypeRaw === 'issue'
              ? { issueId: entityId }
          : { jobId: entityId }

    const attachment = await prisma.attachment.create({
      data: {
        ...data,
        fileName,
        url,
        key,
        mimeType,
        fileSize,
        uploadedById: user.id,
      },
    })

    return NextResponse.json({ attachment }, { status: 201 })
  } catch (error) {
    console.error('Create attachment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
