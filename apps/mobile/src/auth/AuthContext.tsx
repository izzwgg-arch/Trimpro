import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { apiRequest, setUnauthorizedHandler } from '../api/client'
import { clearAuth, getAccessToken, getStoredUser, saveAuth } from './secure-storage'
import { AuthUser } from '../types/models'

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
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
        }
      } finally {
        if (mounted) setIsLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const response = await apiRequest<LoginResponse>('/api/auth/login', 'POST', { email, password })
    setToken(response.accessToken)
    setUser(response.user)
    await saveAuth(response.accessToken, response.refreshToken, JSON.stringify(response.user))
  }, [])

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      signIn,
      signOut,
    }),
    [isLoading, signIn, signOut, token, user]
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

