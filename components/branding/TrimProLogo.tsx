import { cn } from '@/lib/utils'

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

export function TrimProLogo({ variant = 'light', size = 'md', className }: TrimProLogoProps) {
  const dimensions = sizeMap[size]

  return (
    <div className={cn('inline-flex items-center', className)}>
      <img
        src="/branding/trimpro-logo.svg"
        alt="TrimPro"
        width={dimensions.width}
        height={dimensions.height}
        className="block"
        style={{ width: dimensions.width, height: dimensions.height, objectFit: 'contain' }}
      />
    </div>
  )
}
