import { cn } from '@/lib/utils'

interface TrimProMarkProps {
  size?: number
  className?: string
  color?: string
}

export function TrimProMark({ size = 28, className, color = '#FFFFFF' }: TrimProMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      shapeRendering="crispEdges"
      style={{ display: 'block' }}
    >
      {/* CAP */}
      <rect x="4" y="4" width="16" height="3" fill={color} />

      {/* DOTS (SQUARES). FLUSH means: dot TOP touches cap bottom (cap bottom = y=7) */}
      {/* so dots y=7. */}
      <rect x="7" y="7" width="3" height="3" fill={color} />
      <rect x="14" y="7" width="3" height="3" fill={color} />

      {/* TWO VERTICAL BARS (same thickness, same height) */}
      <rect x="10" y="10" width="3" height="12" fill={color} />
      <rect x="14" y="10" width="3" height="12" fill={color} />
    </svg>
  )
}

interface TrimProLogoProps {
  variant?: 'sidebar' | 'light'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: 24,
  md: 28,  // Even integer to avoid subpixel blur
  lg: 40,
}

export function TrimProLogo({ variant = 'light', size = 'md', className }: TrimProLogoProps) {
  const iconSize = sizeMap[size]
  const wordHeight = iconSize * 0.85 // Wordmark slightly smaller than icon
  
  const iconColor = variant === 'sidebar' ? '#FFFFFF' : '#0B1F2A'
  const wordColor = '#e6c98b'  // Exact color for wordmark
  
  return (
    <div className={cn('inline-flex items-center', className)} style={{ gap: '10px' }}>
      {/* Wordmark */}
      <span
        style={{
          fontFamily: '"Montserrat Alternates", "Montserrat", "Poppins", system-ui, sans-serif',
          fontWeight: 700,
          fontSize: `${wordHeight}px`,
          letterSpacing: '-0.02em',
          textTransform: 'lowercase',
          color: wordColor,
          lineHeight: 1,
        }}
      >
        trimpro
      </span>
      
      {/* Icon on the right - fixed wrapper to prevent scaling */}
      <div
        style={{
          width: iconSize,
          height: iconSize,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto',
        }}
      >
        <TrimProMark size={iconSize} color={iconColor} />
      </div>
    </div>
  )
}
