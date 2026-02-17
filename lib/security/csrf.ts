import { NextRequest, NextResponse } from 'next/server'

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '')
}

function getAppOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_URL || process.env.APP_URL
  if (!raw) return null
  try {
    const u = new URL(raw)
    return normalizeOrigin(u.origin)
  } catch {
    return null
  }
}

/**
 * Lightweight CSRF protection for bearer-token authenticated API routes:
 * require Origin/Referer to match our app origin.
 */
export function requireSameOrigin(request: NextRequest): NextResponse | null {
  const expected = getAppOrigin()
  if (!expected) return null // can't verify, don't block

  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  const actual = origin || (referer ? (() => {
    try { return new URL(referer).origin } catch { return null }
  })() : null)

  if (!actual) {
    return NextResponse.json({ error: 'Missing Origin/Referer' }, { status: 403 })
  }

  if (normalizeOrigin(actual) !== expected) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  }

  return null
}

