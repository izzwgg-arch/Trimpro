'use client'

import { useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TrimProLogo } from '@/components/branding/TrimProLogo'

function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.requiresPasswordChange) {
          // Redirect to set password page
          router.push(`/auth/set-password?userId=${data.userId}`)
          return
        }
        setError(data.error || 'Login failed')
        setLoading(false)
        return
      }

      // Store tokens
      localStorage.setItem('accessToken', data.accessToken)
      localStorage.setItem('refreshToken', data.refreshToken)
      localStorage.setItem('user', JSON.stringify(data.user))

      // Redirect to dashboard
      router.push('/dashboard')
    } catch (err) {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="pt-10 pb-3 space-y-2">
          <CardTitle className="text-center">
            <div className="flex justify-center">
              <div className="inline-flex items-center rounded-md px-4 py-2" style={{ backgroundColor: 'var(--brand-sidebar-color)' }}>
                <TrimProLogo variant="light" size="lg" />
              </div>
            </div>
          </CardTitle>
          <CardDescription className="text-center">
            Sign in to your account
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-1">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              style={{ backgroundColor: 'var(--brand-button-color)', color: 'var(--brand-button-text-color)' }}
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
            <div className="text-center">
              <a
                href="/auth/forgot-password"
                className="text-sm hover:underline"
                style={{ color: 'var(--brand-link-color)' }}
              >
                Forgot password?
              </a>
            </div>
          </form>
          <div className="mt-6 border-t pt-4 text-center text-xs text-muted-foreground">
            <span>By signing in, you agree to our </span>
            <Link href="/terms" className="hover:underline" style={{ color: 'var(--brand-link-color)' }}>
              Terms
            </Link>
            <span> and </span>
            <Link href="/privacy" className="hover:underline" style={{ color: 'var(--brand-link-color)' }}>
              Privacy Policy
            </Link>
            <span>.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
