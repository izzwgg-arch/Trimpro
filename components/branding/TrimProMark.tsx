import { cn } from '@/lib/utils'

interface TrimProMarkProps {
  className?: string
  size?: number
  showWordmark?: boolean
}

export function TrimProMark({ className, size = 22, showWordmark = true }: TrimProMarkProps) {
  return (
    <div className={cn('inline-flex items-center gap-2 leading-none', className)}>
      <span className="inline-flex min-h-[22px] min-w-[22px] items-center justify-center" style={{ overflow: 'visible' }}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 220 224"
          preserveAspectRatio="xMidYMid meet"
          style={{ overflow: 'visible' }}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Top horizontal line */}
          <line x1="8" y1="112" x2="86" y2="112" />
          {/* Bottom horizontal line */}
          <line x1="134" y1="112" x2="212" y2="112" />
          {/* Two middle dots aligned with horizontal lines */}
          <circle cx="104" cy="112" r="4.75" fill="currentColor" />
          <circle cx="116" cy="112" r="4.75" fill="currentColor" />
          {/* Top dot */}
          <circle cx="110" cy="86" r="4.75" fill="currentColor" />
          {/* Bottom dot */}
          <circle cx="110" cy="140" r="4.75" fill="currentColor" />
        </svg>
      </span>
      {showWordmark && (
        <span className="text-[26px] font-semibold tracking-normal">
          TrimPro
        </span>
      )}
    </div>
  )
}
