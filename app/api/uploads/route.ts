import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { promises as fs } from 'fs'
import crypto from 'crypto'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB per file

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

function safeExtFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'video/mp4') return 'mp4'
  if (mime === 'video/quicktime') return 'mov'
  if (mime === 'video/webm') return 'webm'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'application/msword') return 'doc'
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (mime === 'application/vnd.ms-excel') return 'xls'
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (mime === 'text/csv') return 'csv'
  if (mime === 'text/plain') return 'txt'
  if (mime === 'application/zip') return 'zip'
  if (mime === 'application/x-rar-compressed') return 'rar'
  return 'bin'
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

    const contentType = file.type || 'application/octet-stream'
    // Only allow: PDF, JPG, PNG, DOCX
    const allowed = [
      /^application\/pdf$/, // PDF
      /^image\/jpeg$/, // JPG
      /^image\/jpg$/, // JPG (alternative)
      /^image\/png$/, // PNG
      /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/, // DOCX
    ].some((re) => re.test(contentType))
    if (!allowed) {
      console.log('Upload rejected - unsupported file type:', { contentType, fileName: file.name })
      return NextResponse.json({ error: `Unsupported file type. Only PDF, JPG, PNG, and DOCX files are allowed.` }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const size = arrayBuffer.byteLength
    if (size <= 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    }
    if (size > MAX_FILE_BYTES) {
      console.log('Upload rejected - file too large:', { fileName: file.name, size, maxBytes: MAX_FILE_BYTES })
      return NextResponse.json({ error: 'File too large (max 10MB per file)' }, { status: 413 })
    }

    const ext = safeExtFromMime(contentType)
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

