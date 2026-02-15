import { cn } from '@/lib/utils'

interface TrimProMarkProps {
  size?: number
  className?: string
  color?: string
}

export function TrimProMark({ size = 30, className, color = 'currentColor' }: TrimProMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ shapeRendering: 'crispEdges' }}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Top horizontal bar */}
      <rect x="10" y="14" width="100" height="16" rx="0" fill={color} />
      
      {/* Left dot */}
      <circle cx="30" cy="44" r="7" fill={color} />
      
      {/* Right dot */}
      <circle cx="90" cy="44" r="7" fill={color} />
      
      {/* Left vertical column */}
      <rect x="48" y="52" width="10" height="54" rx="0" fill={color} />
      
      {/* Right vertical column */}
      <rect x="62" y="52" width="10" height="54" rx="0" fill={color} />
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
  md: 30,
  lg: 40,
}

export function TrimProLogo({ variant = 'light', size = 'md', className }: TrimProLogoProps) {
  const iconSize = sizeMap[size]
  const wordHeight = iconSize * 0.85 // Wordmark slightly smaller than icon
  
  const iconColor = variant === 'sidebar' ? '#FFFFFF' : '#0B1F2A'
  const wordColor = variant === 'sidebar' ? '#E5C36A' : '#E5C36A'
  
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
      
      {/* Icon on the right */}
      <TrimProMark size={iconSize} color={iconColor} />
    </div>
  )
}
