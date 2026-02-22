import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { apiRequest, setUnauthorizedHandler } from '../api/client'
import { clearAuth, getAccessToken, getStoredUser, saveAuth } from './secure-storage'
import { AuthUser } from '../types/models'

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

  const signOut = useCallback(async () => {
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
        const [storedToken, storedUser] = await Promise.all([getAccessToken(), getStoredUser()])
        if (mounted && storedToken && storedUser) {
          setToken(storedToken)
          setUser(JSON.parse(storedUser) as AuthUser)
          // Fetch permissions on app load
          await fetchPermissions(storedToken)
        }
      } finally {
        if (mounted) setIsLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [fetchPermissions])

  const fetchPermissions = useCallback(async (authToken: string) => {
    try {
      // apiRequest gets token from storage, but we need to ensure it's saved first
      // For initial load, token should already be in storage from signIn
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

  const signIn = useCallback(async (email: string, password: string) => {
    const response = await apiRequest<LoginResponse>('/api/auth/login', 'POST', { email, password })
    setToken(response.accessToken)
    setUser(response.user)
    await saveAuth(response.accessToken, response.refreshToken, JSON.stringify(response.user))
    
    // Fetch permissions after login
    await fetchPermissions(response.accessToken)
  }, [fetchPermissions])

  const refreshPermissions = useCallback(async () => {
    if (token) {
      await fetchPermissions(token)
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

