export class FetchTimeoutError extends Error {
  constructor(timeoutMs: number, url: string) {
    super(`Request timed out after ${timeoutMs}ms: ${url}`)
    this.name = 'FetchTimeoutError'
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new FetchTimeoutError(timeoutMs, url)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
