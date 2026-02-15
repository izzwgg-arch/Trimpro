import { cn } from '@/lib/utils'

interface TrimProMarkProps {
  size?: number
  className?: string
  color?: string
}

export function TrimProMark({ size = 30, className, color = 'currentColor' }: TrimProMarkProps) {
  // Single source of truth for thickness
  const stroke = 3
  
  // Geometry is based on a 24x24 viewBox; scaling is handled by width/height.
  // IMPORTANT ALIGNMENT RULE:
  // - The dots' CENTER y equals the UNDERSIDE y of the top cap.
  // - Underside y = capTopY + capStroke/2 (cap uses same stroke)
  //
  // With stroke applied, visual underside is exactly at y = capY (because the line is centered).
  // So we define capY and dotCenterY to be identical.
  const capY = 5         // y of the top horizontal stroke centerline
  const dotY = capY      // MUST MATCH capY to be flush
  const leftDotX = 8
  const rightDotX = 16
  
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Top cap */}
      <path
        d="M4 5 H20"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Dots (must be flush with cap) */}
      <circle
        cx={leftDotX}
        cy={dotY}
        r={stroke * 0.55}
        fill={color}
      />
      <circle
        cx={rightDotX}
        cy={dotY}
        r={stroke * 0.55}
        fill={color}
      />

      {/* Two vertical bars */}
      <path
        d="M10.5 8 V20"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 8 V20"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
      
      {/* Icon on the right */}
      <TrimProMark size={iconSize} color={iconColor} />
    </div>
  )
}
