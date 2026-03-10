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

const sizeMap = {
  sm: { width: 120, height: 36 },
  md: { width: 160, height: 48 },
  lg: { width: 200, height: 60 },
}

const DEFAULT_LOGO = '/branding/trimpro-logo.svg'

export function TrimProLogo({ variant = 'light', size = 'md', className }: TrimProLogoProps) {
  const dimensions = sizeMap[size]
  const { webLogoUrl } = useBranding()
  const [errored, setErrored] = useState(false)

  // Reset error flag whenever a new logo URL is supplied
  useEffect(() => {
    setErrored(false)
  }, [webLogoUrl])

  const src = !errored && webLogoUrl ? webLogoUrl : DEFAULT_LOGO

  return (
    <div className={cn('inline-flex items-center', className)}>
      <img
        src={src}
        alt="TrimPro"
        width={dimensions.width}
        height={dimensions.height}
        className="block"
        style={{ width: dimensions.width, height: dimensions.height, objectFit: 'contain' }}
        onError={() => setErrored(true)}
      />
    </div>
  )
}
