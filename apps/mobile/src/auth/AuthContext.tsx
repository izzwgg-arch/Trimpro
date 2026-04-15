import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { apiRequest, setUnauthorizedHandler } from '../api/client'
import { clearAuth, getAccessToken, getOrCreateDeviceId, getRefreshToken, getStoredUser, saveAuth } from './secure-storage'
import { AuthUser } from '../types/models'
import { registerPushToken, unregisterPushToken } from '../notifications/registerPush'
import { API_BASE_URL } from '../config/env'

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  isLoading: boolean
  mobilePermissions: string[]
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshPermissions: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: AuthUser
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [mobilePermissions, setMobilePermissions] = useState<string[]>([])

  const fetchPermissions = useCallback(async () => {
    try {
      const meResponse = await apiRequest<{
        user: AuthUser
        mobilePermissions: string[]
      }>('/api/me')

      setMobilePermissions(meResponse.mobilePermissions || [])
      return meResponse.mobilePermissions || []
    } catch (error) {
      console.error('Failed to fetch permissions:', error)
      setMobilePermissions([])
      return []
    }
  }, [])

  const signOut = useCallback(async () => {
    const refreshToken = await getRefreshToken()
    const deviceId = await getOrCreateDeviceId()
    if (refreshToken) {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'TrimProMobile',
        },
        body: JSON.stringify({ refreshToken, deviceId }),
      }).catch(() => null)
    }
    await unregisterPushToken().catch(() => null)
    setUser(null)
    setToken(null)
    await clearAuth()
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut()
    })
    return () => setUnauthorizedHandler(null)
  }, [signOut])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [storedUser, refreshToken] = await Promise.all([getStoredUser(), getRefreshToken()])
        if (!mounted) return

        if (storedUser && refreshToken) {
          // Trigger a protected request to force token refresh when access token expired.
          const meResponse = await apiRequest<{
            user: AuthUser
            mobilePermissions: string[]
          }>('/api/me')
          const latestAccessToken = await getAccessToken()
          if (latestAccessToken) {
            setToken(latestAccessToken)
          }
          setUser(meResponse.user)
          setMobilePermissions(meResponse.mobilePermissions || [])
        } else {
          await clearAuth()
        }
      } catch (error) {
        console.warn('[auth] session restore failed, clearing local auth state', error)
        await clearAuth()
      } finally {
        if (mounted) setIsLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const deviceId = await getOrCreateDeviceId()
    const response = await apiRequest<LoginResponse>('/api/auth/login', 'POST', {
      email,
      password,
      deviceId,
      clientType: 'mobile',
    })
    await saveAuth(response.accessToken, response.refreshToken, JSON.stringify(response.user))
    setToken(response.accessToken)
    setUser(response.user)

    // Register push immediately after login so backend always has a token.
    await registerPushToken().catch((error) => {
      console.warn('Push registration after login failed:', error)
    })

    // Fetch permissions after login
    await fetchPermissions()
  }, [fetchPermissions])

  const refreshPermissions = useCallback(async () => {
    if (token) {
      await fetchPermissions()
    }
  }, [token, fetchPermissions])

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      mobilePermissions,
      signIn,
      signOut,
      refreshPermissions,
    }),
    [isLoading, signIn, signOut, token, user, mobilePermissions, refreshPermissions]
  )

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

