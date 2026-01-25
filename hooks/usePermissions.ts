'use client'

import { useState, useEffect } from 'react'

interface PermissionState {
  permissions: string[]
  loading: boolean
  error: string | null
}

/**
 * Hook to get user permissions for client-side UI enforcement
 */
export function usePermissions(): PermissionState {
  const [state, setState] = useState<PermissionState>({
    permissions: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        const token = localStorage.getItem('accessToken')
        if (!token) {
          setState({ permissions: [], loading: false, error: 'Not authenticated' })
          return
        }

        const response = await fetch('/api/auth/permissions', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (response.ok) {
          const data = await response.json()
          setState({
            permissions: data.permissions || [],
            loading: false,
            error: null,
          })
        } else {
          setState({ permissions: [], loading: false, error: 'Failed to fetch permissions' })
        }
      } catch (error) {
        console.error('Error fetching permissions:', error)
        setState({ permissions: [], loading: false, error: 'Error fetching permissions' })
      }
    }

    fetchPermissions()
  }, [])

  return state
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(permissions: string[], permission: string): boolean {
  return permissions.includes(permission)
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(permissions: string[], requiredPermissions: string[]): boolean {
  return requiredPermissions.some((perm) => permissions.includes(perm))
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(permissions: string[], requiredPermissions: string[]): boolean {
  return requiredPermissions.every((perm) => permissions.includes(perm))
}
