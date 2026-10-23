'use client'

/** `tel:` link for a phone number as written (keeps a leading +, drops spaces and punctuation). */
export function telHref(phone: string | null | undefined): string {
  return `tel:${String(phone ?? '').replace(/[^\d+]/g, '')}`
}

/**
 * A phone number you can click to call: opens the phone app on mobile and the
 * computer's calling app (Phone Link, Teams, FaceTime…) on a PC or Mac.
 */
export function PhoneLink({ phone, className = '' }: { phone: string | null | undefined; className?: string }) {
  if (!phone) return null
  return (
    <a
      href={telHref(phone)}
      onClick={(e) => e.stopPropagation()}
      className={`text-blue-600 hover:underline ${className}`}
    >
      {phone}
    </a>
  )
}
