import { cn } from '@/lib/utils'

interface TrimProMarkProps {
  size?: number
  className?: string
  color?: string
}

export function TrimProMark({ size = 30, className, color = 'currentColor' }: TrimProMarkProps) {
  // Geometry constants - single source of truth
  const CAP_X = 10
  const CAP_Y = 14
  const CAP_W = 100
  const CAP_H = 16
  
  const BAR_TOP_Y = 52        // Top Y of vertical bars
  const BAR_W = 10            // Bar width (both bars use this - identical thickness)
  const BAR_H = 54            // Bar height (both bars use this)
  const BAR_GAP = 4           // Gap between bars (62 - (48 + 10) = 4)
  
  const LEFT_BAR_X = 48
  const RIGHT_BAR_X = 62
  
  // Calculate bar centers for dot alignment
  const LEFT_BAR_CENTER_X = LEFT_BAR_X + BAR_W / 2   // 48 + 5 = 53
  const RIGHT_BAR_CENTER_X = RIGHT_BAR_X + BAR_W / 2  // 62 + 5 = 67
  
  const DOT_SIZE = 6          // Dot size (square)
  
  // Dots flush with bar tops: dot bottom = BAR_TOP_Y
  // For rect: y + height = BAR_TOP_Y, so y = BAR_TOP_Y - height
  const DOT_Y = BAR_TOP_Y - DOT_SIZE  // 52 - 6 = 46 (dot bottom will be at 52)
  
  // Dot X positions: centered above bars
  const LEFT_DOT_X = LEFT_BAR_CENTER_X - DOT_SIZE / 2   // 53 - 3 = 50
  const RIGHT_DOT_X = RIGHT_BAR_CENTER_X - DOT_SIZE / 2  // 67 - 3 = 64
  
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      shapeRendering="crispEdges"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Top horizontal cap */}
      <rect x={CAP_X} y={CAP_Y} width={CAP_W} height={CAP_H} rx="0" fill={color} />
      
      {/* Left dot - square, centered above left bar, flush with bar top */}
      <rect x={LEFT_DOT_X} y={DOT_Y} width={DOT_SIZE} height={DOT_SIZE} rx="0" fill={color} />
      
      {/* Right dot - square, centered above right bar, flush with bar top */}
      <rect x={RIGHT_DOT_X} y={DOT_Y} width={DOT_SIZE} height={DOT_SIZE} rx="0" fill={color} />
      
      {/* Left vertical bar - uses BAR_W constant */}
      <rect x={LEFT_BAR_X} y={BAR_TOP_Y} width={BAR_W} height={BAR_H} rx="0" fill={color} />
      
      {/* Right vertical bar - uses BAR_W constant (identical thickness) */}
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
