import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { promises as fs } from 'fs'

export const runtime = 'nodejs'

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
}

function getMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    // Reconstruct the relative path and resolve to public/uploads/
    const segments = (params.path ?? []).map((seg) => decodeURIComponent(seg))

    // Prevent path traversal
    for (const seg of segments) {
      if (seg.includes('..') || seg.includes('/') || seg.includes('\\')) {
        return new NextResponse('Forbidden', { status: 403 })
      }
    }

    const filePath = path.join(process.cwd(), 'public', 'uploads', ...segments)
    const fileBuffer = await fs.readFile(filePath)
    const mime = getMime(segments[segments.length - 1] ?? '')

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(fileBuffer.length),
      },
    })
  } catch {
    return new NextResponse('Not Found', { status: 404 })
  }
}
