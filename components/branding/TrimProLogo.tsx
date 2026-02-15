import { cn } from '@/lib/utils'

interface TrimProMarkProps {
  size?: number
  className?: string
  color?: string
}

export function TrimProMark({ size = 30, className, color = 'currentColor' }: TrimProMarkProps) {
  // Geometry constants - single source of truth
  const BAR_TOP_Y = 52        // Top Y of vertical bars
  const BAR_W = 10            // Bar width (both bars use this)
  const BAR_H = 54            // Bar height (both bars use this)
  const DOT_R = 7             // Dot radius
  const DOT_SIZE = DOT_R * 2  // Dot diameter (14)
  
  // Dots flush with bar tops: DOT_Y + DOT_SIZE == BAR_TOP_Y
  // So: DOT_Y = BAR_TOP_Y - DOT_SIZE = 52 - 14 = 38
  const DOT_Y = BAR_TOP_Y - DOT_SIZE  // Top of dot
  const DOT_CY = DOT_Y + DOT_R        // Center Y of dot (38 + 7 = 45)
  
  // Bar positions (symmetric around center)
  const LEFT_BAR_X = 48
  const RIGHT_BAR_X = 62
  
  // Dot positions (symmetric around center)
  const LEFT_DOT_CX = 30
  const RIGHT_DOT_CX = 90
  
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
      
      {/* Left dot - flush with bar tops */}
      <circle cx={LEFT_DOT_CX} cy={DOT_CY} r={DOT_R} fill={color} />
      
      {/* Right dot - flush with bar tops */}
      <circle cx={RIGHT_DOT_CX} cy={DOT_CY} r={DOT_R} fill={color} />
      
      {/* Left vertical column - uses BAR_W constant */}
      <rect x={LEFT_BAR_X} y={BAR_TOP_Y} width={BAR_W} height={BAR_H} rx="0" fill={color} />
      
      {/* Right vertical column - uses BAR_W constant (identical thickness) */}
      <rect x={RIGHT_BAR_X} y={BAR_TOP_Y} width={BAR_W} height={BAR_H} rx="0" fill={color} />
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
