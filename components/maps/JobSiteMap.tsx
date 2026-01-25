'use client'

import { useEffect, useRef } from 'react'

interface JobSiteMapProps {
  address: {
    street: string
    city: string
    state: string
    zipCode: string
    country?: string
  }
  jobTitle?: string
  height?: string
  zoom?: number
}

export function JobSiteMap({ address, jobTitle, height = '400px', zoom = 15 }: JobSiteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mapRef.current || !window.google) return

    const fullAddress = `${address.street}, ${address.city}, ${address.state} ${address.zipCode}`
    
    const geocoder = new (window as any).google.maps.Geocoder()
    geocoder.geocode({ address: fullAddress }, (results: any, status: any) => {
      if (status === 'OK' && results && results[0]) {
        const location = results[0].geometry.location

        const map = new (window as any).google.maps.Map(mapRef.current!, {
          center: location,
          zoom: zoom,
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
        })

        const marker = new (window as any).google.maps.Marker({
          position: location,
          map: map,
          title: jobTitle || fullAddress,
          icon: {
            url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png',
          },
        })

        // Add info window
        if (jobTitle) {
          const infoWindow = new (window as any).google.maps.InfoWindow({
            content: `<div><strong>${jobTitle}</strong><br/>${fullAddress}</div>`,
          })
          marker.addListener('click', () => {
            infoWindow.open(map, marker)
          })
        }
      } else {
        if (mapRef.current) {
          mapRef.current.innerHTML = `
            <div class="flex items-center justify-center h-full bg-gray-100 text-gray-600">
              <p>Unable to load map for this job site</p>
            </div>
          `
        }
      }
    })
  }, [address, jobTitle, zoom])

  return (
    <div className="w-full rounded-lg overflow-hidden border border-gray-300">
      <div ref={mapRef} style={{ height }} className="w-full" />
    </div>
  )
}
