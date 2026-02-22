import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { createNotificationsForUsers, notifyDispatchJobActivity } from '@/lib/notifications'
import { publishDispatchRealtime } from '@/lib/dispatch-realtime'

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
    const metadata = body?.metadata && typeof body.metadata === 'object' ? body.metadata : null

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

    if (entityTypeRaw === 'job') {
      try {
        const [job, uploader] = await Promise.all([
          prisma.job.findFirst({
            where: { id: entityId, tenantId: user.tenantId },
            include: {
              assignments: { select: { userId: true } },
            },
          }),
          prisma.user.findUnique({
            where: { id: user.id },
            select: { firstName: true, lastName: true, email: true },
          }),
        ])

        if (job) {
          const mediaKind = attachment.mimeType.startsWith('image/')
            ? 'photo'
            : attachment.mimeType.startsWith('video/')
            ? 'video'
            : 'file'

          // Helper to clean up filename - remove UUIDs and show friendly text
          const getCleanFileDescription = (fileName: string, mimeType: string): string => {
            // Check if filename looks like a UUID (contains 8-4-4-4-12 pattern)
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
            if (uuidPattern.test(fileName)) {
              // It's a UUID, return friendly description based on mime type
              if (mimeType.startsWith('image/')) return 'a photo'
              if (mimeType.startsWith('video/')) return 'a video'
              return 'a file'
            }
            // Not a UUID, return the filename (but maybe truncate if too long)
            return fileName.length > 30 ? fileName.substring(0, 27) + '...' : fileName
          }

          // Build actor name with proper fallbacks
          let actorName = 'A team member'
          if (uploader) {
            const fullName = `${uploader.firstName || ''} ${uploader.lastName || ''}`.trim()
            actorName = fullName || uploader.email || user.email || 'A team member'
          } else if (user.email) {
            actorName = user.email
          }

          await prisma.dispatchEvent.create({
            data: {
              tenantId: user.tenantId,
              jobId: entityId,
              eventType: 'NOTE_ADDED',
              actorUserId: user.id,
              payload: {
                kind: 'media_uploaded',
                attachmentId: attachment.id,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                fileSize: attachment.fileSize,
                metadata,
              },
            },
          })

          publishDispatchRealtime(user.tenantId, {
            id: `att_${attachment.id}`,
            kind: mediaKind,
            ts: attachment.createdAt.toISOString(),
            jobId: entityId,
            attachment: {
              id: attachment.id,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              url: attachment.url,
              fileSize: attachment.fileSize,
            },
            payload: { metadata },
            job: {
              id: job.id,
              jobNumber: job.jobNumber,
              title: job.title,
            },
          })

          const cleanFileDesc = getCleanFileDescription(attachment.fileName, attachment.mimeType)
          const jobDisplayName = (job.title || job.jobNumber || 'Job').trim()
          const jobNumber = job.jobNumber || 'Unknown'

          const recipientIds = Array.from(new Set(job.assignments.map((a) => a.userId).filter((id) => id !== user.id)))
          if (recipientIds.length > 0) {
            try {
              await createNotificationsForUsers(user.tenantId, recipientIds, {
                type: 'OTHER',
                title: `${actorName} uploaded ${cleanFileDesc}`,
                message: `${jobDisplayName} (${jobNumber})`,
                linkType: 'job',
                linkId: job.id,
                linkUrl: `/dashboard/dispatch?jobId=${job.id}`,
              })
            } catch (notifError) {
              console.error('Failed to create notifications for assigned users:', notifError)
            }
          }

          try {
            await notifyDispatchJobActivity({
              tenantId: user.tenantId,
              jobId: job.id,
              title: `${actorName} uploaded ${cleanFileDesc}`,
              message: `${jobDisplayName} (${jobNumber})`,
              excludeUserId: user.id,
            })
          } catch (dispatchNotifError) {
            console.error('Failed to create dispatch notifications:', dispatchNotifError)
          }
        }
      } catch (error) {
        console.error('Attachment dispatch fanout error:', error)
      }
    }

    return NextResponse.json({ attachment }, { status: 201 })
  } catch (error) {
    console.error('Create attachment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
