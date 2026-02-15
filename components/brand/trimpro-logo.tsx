import { cn } from '@/lib/utils'
import Image from 'next/image'

interface TrimproLogoProps {
  className?: string
  title?: string
  variant?: 'full' | 'icon'
}

export function TrimproLogo({
  className,
  title = 'TrimPro',
  variant = 'full',
}: TrimproLogoProps) {
  return (
    <Image
      src={variant === 'icon' ? '/branding/trimpro-icon.svg' : '/branding/trimpro-logo.svg'}
      alt={title}
      width={variant === 'icon' ? 26 : 320}
      height={variant === 'icon' ? 26 : 64}
      className={cn(
        variant === 'icon' ? 'h-6 w-6 sm:h-[26px] sm:w-[26px]' : 'h-10 w-auto',
        className
      )}
      priority
    />
  )
}

