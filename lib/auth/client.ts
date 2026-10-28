// Client-side auth helpers (token storage + refresh).
// Goal: prevent "random logouts" caused by concurrent refresh token rotation.
//
// We rotate refresh tokens on every refresh. If multiple requests refresh at once,
// one of them will succeed and invalidate the old refresh token, and another will
// fail with 401. Without a mutex + retry, the UI often redirects to /auth/login.

let refreshInFlight: Promise<boolean> | null = null
const REFRESHED_AT_KEY = 'trimpro:authRefreshedAt'

async function refreshWithToken(refreshToken: string): Promise<boolean> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, clientType: 'web' }),
  })

  if (!response.ok) return false
  const data = await readResponseJson<{ accessToken?: string; refreshToken?: string }>(response).catch(
    () => null
  )
  if (!data?.accessToken || !data?.refreshToken) return false
  localStorage.setItem('accessToken', data.accessToken)
  localStorage.setItem('refreshToken', data.refreshToken)
  localStorage.setItem(REFRESHED_AT_KEY, String(Date.now()))
  return true
}

// Tabs and the call window share localStorage. A cross-tab lock makes them take turns, and a
// tab that waited just picks up the token the other tab stored instead of refreshing again.
async function withRefreshLock(run: () => Promise<boolean>): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (!locks?.request) return run()
  return locks.request('trimpro-auth-refresh', run)
}

export async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight

  const tokenBeforeLock = localStorage.getItem('refreshToken')
  refreshInFlight = withRefreshLock(async () => {
    const initialRefreshToken = localStorage.getItem('refreshToken')
    if (!initialRefreshToken) return false
    if (tokenBeforeLock && initialRefreshToken !== tokenBeforeLock && localStorage.getItem('accessToken')) {
      return true
    }
    // A 401 for a request sent with the old token just before another refresh finished:
    // the stored token is already fresh, so retrying is enough.
    const refreshedAt = Number(localStorage.getItem(REFRESHED_AT_KEY) || 0)
    if (Date.now() - refreshedAt < 15_000 && accessTokenSecondsLeft() > 60) return true

    // Attempt refresh with the token we started with.
    let ok = false
    try {
      ok = await refreshWithToken(initialRefreshToken)
    } catch {
      ok = false
    }

    if (ok) return true

    // If refresh failed, we might have raced another refresh (same tab or another tab)
    // that already rotated the refreshToken in localStorage.
    const currentRefreshToken = localStorage.getItem('refreshToken')
    const currentAccessToken = localStorage.getItem('accessToken')

    if (currentRefreshToken && currentRefreshToken !== initialRefreshToken && currentAccessToken) {
      return true
    }

    // One more best-effort retry with the latest refreshToken if it changed.
    if (currentRefreshToken && currentRefreshToken !== initialRefreshToken) {
      try {
        return await refreshWithToken(currentRefreshToken)
      } catch {
        return false
      }
    }

    return false
  }).finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

/** Seconds until the stored access token expires (0 when missing or unreadable). */
function accessTokenSecondsLeft(): number {
  const token = localStorage.getItem('accessToken')
  if (!token) return 0
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const { exp } = JSON.parse(atob(part)) as { exp?: number }
    return typeof exp === 'number' ? exp - Date.now() / 1000 : 0
  } catch {
    return 0
  }
}

/**
 * Refreshes the access token shortly before it expires (and when the tab wakes up), so
 * pages that call fetch directly never send an expired token and bounce to the login page.
 * Returns a cleanup function.
 */
export function keepSessionFresh(): () => void {
  const check = () => {
    if (!localStorage.getItem('refreshToken')) return
    if (accessTokenSecondsLeft() < 120) void refreshAccessToken()
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }
  check()
  const timer = window.setInterval(check, 60_000)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', check)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', check)
  }
}

function buildAuthHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init || {})
  const token = localStorage.getItem('accessToken')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return headers
}

/**
 * Read a fetch Response as JSON, with a clear error when the server returns HTML
 * (login page, Next error page, proxy page, etc.) instead of JSON.
 */
export async function readResponseJson<T = unknown>(response: Response): Promise<T> {
  const text = await response.text()
  const trimmed = text.trim()
  if (!trimmed) return {} as T

  if (trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
    throw new Error(`Server returned a web page instead of data (${response.status})`)
  }

  try {
    return JSON.parse(trimmed) as T
  } catch {
    throw new Error(`Invalid server response (${response.status})`)
  }
}

/**
 * Authenticated fetch for dashboard API calls.
 * On 401, refreshes the access token once and retries the request.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const first = await fetch(input, { ...init, headers: buildAuthHeaders(init.headers) })
  if (first.status !== 401) return first

  if (init.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const refreshed = await refreshAccessToken()
  if (!refreshed) return first

  if (init.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  return fetch(input, { ...init, headers: buildAuthHeaders(init.headers) })
}
