import { cn } from '@/lib/utils'

interface TrimProMarkProps {
  size?: number
  className?: string
  color?: string
}

export function TrimProMark({ size = 28, className, color = '#FFFFFF' }: TrimProMarkProps) {
  // ViewBox is 24. Shapes are drawn with fills (rect/circle) so thickness is exact.
  // Top cap thickness = 3
  // Vertical bars thickness = 3
  // Dot size = 3x3 (circle r=1.5)
  // Dots sit immediately under the cap (touching it): dotTopY = capBottomY
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {/* TOP CAP: centered, flat ends like the logo */}
      {/* cap: x=4, y=4, w=16, h=3 */}
      <rect x="4" y="4" width="16" height="3" rx="0" fill={color} />

      {/* DOTS: same thickness as bars; flush under cap */}
      {/* cap bottom is y=7, so dots start at y=7 */}
      <circle cx="8" cy="8.5" r="1.5" fill={color} />
      <circle cx="16" cy="8.5" r="1.5" fill={color} />

      {/* VERTICAL BARS: equal thickness + equal height */}
      {/* bars: thickness=3; x positions match logo spacing */}
      <rect x="10" y="10" width="3" height="12" rx="0" fill={color} />
      <rect x="14" y="10" width="3" height="12" rx="0" fill={color} />
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
      
      {/* Icon on the right */}
      <TrimProMark size={iconSize} color={iconColor} />
    </div>
  )
}
