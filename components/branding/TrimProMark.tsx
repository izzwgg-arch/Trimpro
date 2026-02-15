import { cn } from '@/lib/utils'

interface TrimProMarkProps {
  className?: string
  size?: number
  showWordmark?: boolean
}

export function TrimProMark({ className, size = 22, showWordmark = true }: TrimProMarkProps) {
  return (
    <div className={cn('inline-flex items-center gap-2 leading-none', className)}>
      <span className="inline-flex h-[22px] w-[22px] items-center justify-center overflow-visible">
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          preserveAspectRatio="xMidYMid meet"
          style={{ overflow: 'visible' }}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="2.5" y1="12" x2="9" y2="12" />
          <line x1="15" y1="12" x2="21.5" y2="12" />
          <circle cx="10.7" cy="12" r="0.9" fill="currentColor" />
          <circle cx="13.3" cy="12" r="0.9" fill="currentColor" />
          <circle cx="12" cy="6.7" r="0.9" fill="currentColor" />
          <circle cx="12" cy="17.3" r="0.9" fill="currentColor" />
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
