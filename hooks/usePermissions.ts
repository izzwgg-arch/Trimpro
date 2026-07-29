'use client'

import { useState, useEffect } from 'react'
import { hasPermissionKey } from '@/lib/permission-aliases'

interface PermissionState {
  permissions: string[]
  loading: boolean
  error: string | null
}

type PermissionsCacheEntry = {
  token: string
  permissions: string[]
  error: string | null
  promise: Promise<string[]> | null
}

let cache: PermissionsCacheEntry | null = null
const listeners = new Set<(state: PermissionState) => void>()

function notify(state: PermissionState) {
  for (const listener of listeners) listener(state)
}

function clearPermissionsCache() {
  cache = null
}

async function loadPermissions(token: string): Promise<string[]> {
  if (cache && cache.token === token && cache.permissions.length > 0 && !cache.error) {
    return cache.permissions
  }

  if (cache && cache.token === token && cache.promise) {
    return cache.promise
  }

  const entry: PermissionsCacheEntry = {
    token,
    permissions: cache?.token === token ? cache.permissions : [],
    error: null,
    promise: null,
  }
  cache = entry

  entry.promise = (async () => {
    const response = await fetch('/api/auth/permissions', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      throw new Error('Failed to fetch permissions')
    }
    const data = await response.json()
    const permissions = Array.isArray(data.permissions) ? data.permissions : []
    entry.permissions = permissions
    entry.error = null
    entry.promise = null
    return permissions
  })()

  try {
    return await entry.promise
  } catch (error) {
    entry.promise = null
    entry.error = error instanceof Error ? error.message : 'Error fetching permissions'
    entry.permissions = []
    throw error
  }
}

/**
 * Hook to get user permissions for client-side UI enforcement.
 * Shared across all consumers so the sidebar/guards don't stampede /api/auth/permissions.
 */
export function usePermissions(): PermissionState {
  const [state, setState] = useState<PermissionState>(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
    if (token && cache && cache.token === token && cache.permissions.length > 0) {
      return { permissions: cache.permissions, loading: false, error: cache.error }
    }
    return { permissions: [], loading: true, error: null }
  })

  useEffect(() => {
    let cancelled = false
    listeners.add(setState)

    const run = async () => {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        clearPermissionsCache()
        if (!cancelled) setState({ permissions: [], loading: false, error: 'Not authenticated' })
        return
      }

      // Token rotated (login/logout) — drop stale cache.
      if (cache && cache.token !== token) {
        clearPermissionsCache()
      }

      if (cache && cache.token === token && cache.permissions.length > 0 && !cache.error) {
        if (!cancelled) {
          setState({ permissions: cache.permissions, loading: false, error: null })
        }
        return
      }

      if (!cancelled) setState((prev) => ({ ...prev, loading: true, error: null }))

      try {
        const permissions = await loadPermissions(token)
        if (!cancelled) {
          setState({ permissions, loading: false, error: null })
          notify({ permissions, loading: false, error: null })
        }
      } catch (error) {
        console.error('Error fetching permissions:', error)
        const message = error instanceof Error ? error.message : 'Error fetching permissions'
        if (!cancelled) {
          setState({ permissions: [], loading: false, error: message })
          notify({ permissions: [], loading: false, error: message })
        }
      }
    }

    void run()

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'accessToken') {
        clearPermissionsCache()
        void run()
      }
    }
    window.addEventListener('storage', onStorage)

    return () => {
      cancelled = true
      listeners.delete(setState)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return state
}

/** Call after login/logout so the next mount refetches for the new session. */
export function resetPermissionsCache() {
  clearPermissionsCache()
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(permissions: string[], permission: string): boolean {
  return hasPermissionKey(permissions, permission)
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(permissions: string[], requiredPermissions: string[]): boolean {
  return requiredPermissions.some((perm) => hasPermissionKey(permissions, perm))
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(permissions: string[], requiredPermissions: string[]): boolean {
  return requiredPermissions.every((perm) => hasPermissionKey(permissions, perm))
}
