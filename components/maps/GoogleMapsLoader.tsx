'use client'

import { useEffect, useState } from 'react'
import { loadGoogleMapsScript } from './AddressMap'

interface GoogleMapsLoaderProps {
  children: React.ReactNode
}

export function GoogleMapsLoader({ children }: GoogleMapsLoaderProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) {
      setError('Google Maps API key not configured')
      setLoaded(true)
      return
    }

    if (window.google && window.google.maps) {
      setLoaded(true)
      return
    }

    loadGoogleMapsScript(apiKey)
      .then(() => {
        setLoaded(true)
        setError(null)
      })
      .catch((err) => {
        console.error('Failed to load Google Maps:', err)
        setError('Failed to load Google Maps. Please check your API key.')
        setLoaded(true) // Still render children even if maps fail
      })
  }, [])

  if (error) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-sm text-yellow-800">{error}</p>
        <p className="text-xs text-yellow-600 mt-1">
          Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to your .env file
        </p>
      </div>
    )
  }

  return <>{children}</>
}
