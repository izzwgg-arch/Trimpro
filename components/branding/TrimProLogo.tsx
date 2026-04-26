'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useBranding } from '@/components/branding/BrandingProvider'

interface TrimProMarkProps {
  size?: number
  className?: string
}

export function TrimProIcon({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <img
      src="/branding/trimpro-icon.svg"
      alt="TrimPro"
      width={size}
      height={size}
      className={cn('block', className)}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  )
}

export function TrimProMark({ size = 30, className }: TrimProMarkProps) {
  return <TrimProIcon className={className} size={size} />
}

interface TrimProLogoProps {
  variant?: 'sidebar' | 'light'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * Height caps per size — width is always `auto` so the logo renders at its
 * natural aspect ratio without squishing. A max-width guard prevents very
 * wide panoramic logos from overflowing the sidebar.
 */
const sizeMap = {
  sm: { height: 36, maxWidth: 160 },
  md: { height: 52, maxWidth: 200 },
  lg: { height: 64, maxWidth: 240 },
} as const

/**
 * Sidebar header stays compact (h-16). Logo is sized up to fill that row
 * (~90% of header height) without increasing header padding or height.
 */
const SIDEBAR_LOGO_DIMS = { height: 58, maxWidth: 252 } as const

function resolveLogoDims(variant: 'sidebar' | 'light', size: keyof typeof sizeMap) {
  if (variant === 'sidebar') return SIDEBAR_LOGO_DIMS
  return sizeMap[size]
}

const DEFAULT_LOGO = '/branding/trimpro-logo.svg'

export function TrimProLogo({ variant = 'light', size = 'md', className }: TrimProLogoProps) {
  const { height, maxWidth } = resolveLogoDims(variant, size)
  const { webLogoUrl } = useBranding()
  const [errored, setErrored] = useState(false)

  // Reset error flag whenever a new logo URL is supplied (e.g. after branding API fetch)
  useEffect(() => {
    setErrored(false)
  }, [webLogoUrl])

  const src = !errored && webLogoUrl ? webLogoUrl : DEFAULT_LOGO

  return (
    <div
      className={cn('inline-flex min-h-0 max-w-full items-center justify-start', className)}
      style={{ height, maxWidth }}
    >
      <img
        src={src}
        alt="TrimPro"
        className="block h-full w-auto max-h-full max-w-full object-contain object-left"
        style={{ objectPosition: 'left center' }}
        onError={() => setErrored(true)}
      />
    </div>
  )
}
