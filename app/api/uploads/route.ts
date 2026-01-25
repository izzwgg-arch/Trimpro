import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { promises as fs } from 'fs'
import crypto from 'crypto'
import { authenticateRequest, getAuthUser } from '@/lib/middleware'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB

function getPublicBaseUrl(req: NextRequest): string {
  // Prefer explicit config (recommended in production)
  const envUrl =
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL

  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    // Force HTTPS if it's already HTTPS, or if we're in production
    let url = envUrl.trim().replace(/\/+$/, '')
    // If it's HTTP but we have a domain configured, upgrade to HTTPS
    if (url.startsWith('http://') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
      url = url.replace('http://', 'https://')
    }
    return url
  }

  // Fall back to request headers (works when directly accessed by public users)
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  if (!host) return ''
  
  // Force HTTPS for production domains (not localhost)
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
  const finalProto = isLocalhost ? proto : 'https'
  return `${finalProto}://${host}`
}

function safeExtFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'bin'
}

export async function POST(request: NextRequest) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const user = getAuthUser(request)

  try {
    const form = await request.formData()
    const file = form.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    const contentType = file.type || 'application/octet-stream'
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image uploads are supported' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const size = arrayBuffer.byteLength
    if (size <= 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    }
    if (size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413 })
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
    console.log('File uploaded successfully:', {
      filename,
      path: absPath,
      size: fileStats.size,
      tenantId: user.tenantId,
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

