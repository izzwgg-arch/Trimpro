import { NextRequest, NextResponse } from 'next/server'

// Public customer links should always resolve on the public HTTPS domain.
// Some email clients will open old/stale links pointing at the server IP/port;
// this redirect keeps those links working without changing any auth logic.
export function middleware(request: NextRequest) {
  const host = String(request.headers.get('host') || '').toLowerCase()

  // Only redirect known "bad" hosts in production.
  if (process.env.NODE_ENV === 'production') {
    const isIpHost =
      host.includes('154.12.235.86') ||
      // Safety: if someone hit the node port directly from email.
      host.endsWith(':3000')

    if (isIpHost) {
      const url = request.nextUrl.clone()
      url.protocol = 'https:'
      url.host = 'app.trimprony.com'
      return NextResponse.redirect(url, 308)
    }
  }

  return NextResponse.next()
}

export const config = {
  // Keep this very narrow to avoid impacting app routing or static assets.
  matcher: ['/approve/estimate/:path*', '/api/public/estimate-approval/:path*'],
}

