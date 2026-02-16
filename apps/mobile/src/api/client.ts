import { API_BASE_URL } from '../config/env'
import { getAccessToken } from '../auth/secure-storage'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export async function apiRequest<T>(
  path: string,
  method: HttpMethod = 'GET',
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(extraHeaders || {}),
  }

  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  })

  if (response.status === 401 && unauthorizedHandler) {
    unauthorizedHandler()
  }

  if (!response.ok) {
    const errorPayload = await response
      .json()
      .catch(() => ({ error: `Request failed with status ${response.status}` }))
    throw new Error(errorPayload?.error || `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

