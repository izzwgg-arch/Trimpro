// Client-side auth helpers (token storage + refresh).
// Goal: prevent "random logouts" caused by concurrent refresh token rotation.
//
// We rotate refresh tokens on every refresh. If multiple requests refresh at once,
// one of them will succeed and invalidate the old refresh token, and another will
// fail with 401. Without a mutex + retry, the UI often redirects to /auth/login.

let refreshInFlight: Promise<boolean> | null = null

async function refreshWithToken(refreshToken: string): Promise<boolean> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, clientType: 'web' }),
  })

  if (!response.ok) return false
  const data = await response.json().catch(() => null)
  if (!data?.accessToken || !data?.refreshToken) return false
  localStorage.setItem('accessToken', data.accessToken)
  localStorage.setItem('refreshToken', data.refreshToken)
  return true
}

export async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const initialRefreshToken = localStorage.getItem('refreshToken')
    if (!initialRefreshToken) return false

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
  })().finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

