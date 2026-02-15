import { cn } from '@/lib/utils'

interface TrimProMarkProps {
  size?: number
  className?: string
  color?: string
}

export function TrimProMark({ size = 30, className, color = 'currentColor' }: TrimProMarkProps) {
  // Parameterized geometry to ensure consistency
  const colW = 12              // Column width (both columns use this)
  const gap = 6                // Gap between columns
  const centerX = 60           // Center of 120 viewBox
  const colTopY = 58           // Top Y of columns
  const colH = 52              // Column height
  const dotCXOffset = 28       // Horizontal offset from center for dot centers
  
  // Calculate column positions (symmetric around center)
  const leftX = centerX - gap/2 - colW
  const rightX = centerX + gap/2
  
  // Calculate dot positions (flush with column tops)
  const dotSize = colW         // Dot size matches column width
  const dotY = colTopY - dotSize  // Dot bottom touches column top
  const leftDotX = centerX - dotCXOffset - dotSize/2
  const rightDotX = centerX + dotCXOffset - dotSize/2
  
  // Top bar (keep current visual weight)
  const topBarH = 16
  const topBarY = 14
  
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
      <rect x="10" y={topBarY} width="100" height={topBarH} rx="0" fill={color} />
      
      {/* Left dot - flush with column top */}
      <rect x={leftDotX} y={dotY} width={dotSize} height={dotSize} rx="2" fill={color} />
      
      {/* Right dot - flush with column top */}
      <rect x={rightDotX} y={dotY} width={dotSize} height={dotSize} rx="2" fill={color} />
      
      {/* Left vertical column */}
      <rect x={leftX} y={colTopY} width={colW} height={colH} rx="0" fill={color} />
      
      {/* Right vertical column - identical width */}
      <rect x={rightX} y={colTopY} width={colW} height={colH} rx="0" fill={color} />
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
