import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { promises as fs } from 'fs'
import crypto from 'crypto'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'
import {
  getMaxBytesForMimeType,
  isAllowedUploadMimeType,
  resolveUploadMimeType,
  safeExtFromMimeType,
} from '@/lib/uploads/policy'

export const runtime = 'nodejs'

function getPublicBaseUrl(req: NextRequest): string {
  // Prefer explicit config (recommended in production)
  const envUrl =
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL

  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    let url = envUrl.trim().replace(/\/+$/, '')

    const host = (() => {
      try {
        return new URL(url).hostname
      } catch {
        return ''
      }
    })()
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
    const isLocal = host === 'localhost' || host === '127.0.0.1'

    // Ignore internal/local env URLs; fall through to request host/public default.
    if (!isIp && !isLocal) {
      url = url.replace('http://', 'https://')
      return url
    }
  }

  // Fall back to request headers (works when directly accessed by public users)
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  if (!host) return ''
  
  // Force HTTPS for production domains (not localhost)
  const isIpHost = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
  if (!isLocalhost && !isIpHost) {
    return `https://${host}`
  }

  return 'https://app.trimprony.com'
}

export async function POST(request: NextRequest) {
  console.log('[uploads] Upload route hit')
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)
  console.log('[uploads] Authenticated user:', { userId: user.id, tenantId: user.tenantId })

  try {
    const form = await request.formData()
    const file = form.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    const contentType = resolveUploadMimeType(file.type || 'application/octet-stream', file.name)
    if (!isAllowedUploadMimeType(contentType, file.name)) {
      console.log('Upload rejected - unsupported file type:', { contentType, fileName: file.name })
      return NextResponse.json(
        {
          error:
            'Unsupported file type. Allowed: PDF, Word, Excel, CSV, PowerPoint, TXT, common images, and common videos.',
        },
        { status: 400 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const size = arrayBuffer.byteLength
    if (size <= 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    }
    const maxBytes = getMaxBytesForMimeType(contentType, file.name)
    if (size > maxBytes) {
      console.log('Upload rejected - file too large:', { fileName: file.name, size, maxBytes, contentType })
      return NextResponse.json(
        { error: `File too large for this type (max ${Math.floor(maxBytes / (1024 * 1024))}MB).` },
        { status: 413 }
      )
    }

    const ext = safeExtFromMimeType(contentType, file.name)
    const id = crypto.randomUUID()
    const filename = `${id}.${ext}`

    const relDir = path.join('public', 'uploads', user.tenantId)
    const absDir = path.join(process.cwd(), relDir)
    await fs.mkdir(absDir, { recursive: true })

    const absPath = path.join(absDir, filename)
    await fs.writeFile(absPath, Buffer.from(arrayBuffer))
    
    // Verify file was written
    const fileStats = await fs.stat(absPath)
    console.log('[uploads] File uploaded successfully:', {
      filename,
      path: absPath,
      size: fileStats.size,
      tenantId: user.tenantId,
      contentType,
      originalFileName: file.name,
    })

    const relUrl = `/uploads/${encodeURIComponent(user.tenantId)}/${encodeURIComponent(filename)}`
    const baseUrl = getPublicBaseUrl(request)
    const url = baseUrl ? `${baseUrl}${relUrl}` : relUrl
    
    console.log('Upload response URLs:', { url, relativeUrl: relUrl, baseUrl })

    return NextResponse.json({
      url,
      relativeUrl: relUrl,
      mimeType: contentType,
      size,
      filename,
    })
  } catch (error: any) {
    console.error('Upload error:', error?.message || error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

